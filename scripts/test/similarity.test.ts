// scripts/test/similarity.test.ts
// 순수 모듈(similarity, embed-core) 단위 테스트. 서버 의존성 없음 → tsx로 바로 실행.
// 실행:  npx tsx scripts/test/similarity.test.ts   (= npm test)

import assert from "node:assert/strict";
import { cosine, norm, topK } from "../../app/api/ask/lib/similarity";
import { hashEmbed } from "../../app/api/ask/lib/embed-core";

let passed = 0;
const failures: string[] = [];
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log("  ✓", name);
  } catch (e) {
    failures.push(name);
    console.log("  ✗", name, "\n     ", (e as Error).message);
  }
}

// ---- cosine ----
check("cosine of identical vectors = 1", () => {
  assert.ok(Math.abs(cosine([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
});
check("cosine of orthogonal vectors = 0", () => {
  assert.equal(cosine([1, 0], [0, 1]), 0);
});
check("cosine with a zero vector = 0 (no NaN)", () => {
  const c = cosine([0, 0, 0], [1, 2, 3]);
  assert.ok(!Number.isNaN(c) && c === 0);
});
check("cosine honors precomputed norms", () => {
  const a = [3, 4]; // norm 5
  const b = [3, 4];
  assert.ok(Math.abs(cosine(a, b, 5, 5) - 1) < 1e-9);
});
check("cosine over mismatched lengths uses min length", () => {
  assert.ok(cosine([1, 0, 0, 0], [1, 0]) > 0);
});

// ---- topK ----
check("topK returns k items sorted desc by score", () => {
  const items = [
    { vec: [1, 0], ref: "a" },
    { vec: [0, 1], ref: "b" },
    { vec: [1, 1], ref: "c" },
  ];
  const r = topK([1, 0], items, 2);
  assert.equal(r.length, 2);
  assert.equal(r[0].ref, "a");
  assert.ok(r[0].score >= r[1].score);
});
check("topK with k > n returns all items", () => {
  const items = [{ vec: [1, 0], ref: "a" }];
  assert.equal(topK([1, 0], items, 5).length, 1);
});
check("topK on empty corpus returns []", () => {
  assert.deepEqual(topK([1, 0], [], 6), []);
});

// ---- hashEmbed (offline fallback embedder) ----
check("hashEmbed is deterministic", () => {
  assert.deepEqual(hashEmbed("반도체 수출"), hashEmbed("반도체 수출"));
});
check("hashEmbed returns a unit vector for real text", () => {
  const v = hashEmbed("한국은행 기준금리 동결");
  assert.equal(v.length, 512);
  assert.ok(Math.abs(norm(v) - 1) < 1e-3);
});
check("hashEmbed: overlapping text scores higher than disjoint", () => {
  const q = hashEmbed("반도체 수출 증가");
  const related = hashEmbed("6월 반도체 수출 두 자릿수 증가");
  const unrelated = hashEmbed("김치찌개 맛있게 끓이는 법");
  assert.ok(cosine(q, related) > cosine(q, unrelated));
});
check("hashEmbed('') is a zero vector and cosine stays safe", () => {
  const z = hashEmbed("");
  assert.equal(z.length, 512);
  assert.equal(cosine(z, hashEmbed("반도체")), 0);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
