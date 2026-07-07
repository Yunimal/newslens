// scripts/smoke-retrieve.ts
// 오프라인 검색 스모크 테스트 — Day 2 산출물(질의 임베딩 → 코사인 top-k) 검증.
// 키 없이 해시 폴백 임베더로 mock 코퍼스를 검색해 결과를 출력한다.
// 실행:  npx tsx scripts/smoke-retrieve.ts   (= npm run smoke:retrieve)
//
// 주의: server-only 모듈을 import하지 않도록 순수 모듈(embed-core/similarity)만 사용하고
//       데이터는 fs로 직접 읽는다(런타임 lib/data.ts는 Next 서버에서만 동작).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashEmbed } from "../app/api/ask/lib/embed-core";
import { topK } from "../app/api/ask/lib/similarity";
import { TAU_MIN_HASH, TOP_K } from "../app/api/ask/lib/config";
import type { ArticlesFile, EmbeddingsFile } from "../types/schema";

// 이 스크립트는 항상 해시 폴백 임베더를 쓰므로 해시용 임계치를 적용한다.
const TAU_MIN = TAU_MIN_HASH;

const dataDir = resolve(process.cwd(), "data");
const articles = JSON.parse(readFileSync(resolve(dataDir, "articles.mock.json"), "utf8")) as ArticlesFile;
const embeddings = JSON.parse(readFileSync(resolve(dataDir, "embeddings.mock.json"), "utf8")) as EmbeddingsFile;

const byId = new Map(articles.articles.map((a) => [a.id, a]));
const indexed = embeddings.items.map((it) => ({ vec: it.v, ref: it.id }));

const queries = [
  "반도체 수출이랑 AI 반도체 요즘 어때?",
  "물가랑 기준금리 상황 정리해줘",
  "요즘 폭염이랑 장마 피해 어때?",
  "축구 대표팀 경기 결과 알려줘",
  "김치찌개 맛있게 끓이는 법", // 코퍼스 밖 → no_result 기대
];

console.log(`corpus: ${articles.articles.length} articles, dim=${embeddings.dim}, model=${embeddings.model}`);
console.log(`TOP_K=${TOP_K}, TAU_MIN=${TAU_MIN}\n`);

let ok = 0;
for (const q of queries) {
  const qv = hashEmbed(q);
  const hits = topK(qv, indexed, TOP_K);
  const best = hits[0]?.score ?? 0;
  const gate = best < TAU_MIN ? "NO_RESULT" : "HIT";
  console.log(`Q: ${q}`);
  console.log(`   best=${best.toFixed(3)} → ${gate}`);
  for (const h of hits.slice(0, 3)) {
    console.log(`   ${h.score.toFixed(3)}  ${h.ref}  ${byId.get(h.ref)?.title ?? "?"}`);
  }
  console.log();
  // sanity: 앞 4개는 코퍼스 안 → HIT 기대, 마지막은 NO_RESULT 기대
  const expectHit = q !== queries[queries.length - 1];
  if (expectHit === best >= TAU_MIN) ok++;
}
console.log(`sanity: ${ok}/${queries.length} queries behaved as expected`);
