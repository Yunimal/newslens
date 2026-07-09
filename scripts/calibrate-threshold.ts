// scripts/calibrate-threshold.ts
// 코사인 임계치(TAU_MIN/TAU_CTX) 캘리브레이션 도구.
// in-corpus(관련 있음) / out-of-corpus(범위 밖) 질문 fixture의 최고 유사도 분포를 측정해
// 두 분포를 가르는 임계치를 제안한다. 실 임베딩 코퍼스(data/embeddings.json) 대상.
//
// 실행:  OPENAI_API_KEY=... npx tsx scripts/calibrate-threshold.ts   (= npm run calibrate)

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { cosine } from "../app/api/ask/lib/similarity";
import { EMBED_DIM, MODEL_EMBED } from "../app/api/ask/lib/config";

/** 코퍼스가 실제로 다루는 주제 (in-corpus) */
const IN_CORPUS = [
  "기상 이변이랑 더위 관련 소식",
  "미국 대통령 관련 뉴스",
  "부동산 시장 어때",
  "최근 정치권 이슈",
  "금리랑 물가 상황",
  "검찰 수사 상황 알려줘",
  "반도체 산업 동향",
  "국회에서 무슨 일 있었어",
  "환율 어떻게 되고 있어",
  "최근 사건사고 정리해줘",
];

/** 코퍼스와 무관한 질문 (out-of-corpus) — 반드시 no_result 나와야 함 */
const OUT_OF_CORPUS = [
  "김치찌개 맛있게 끓이는 법",
  "파이썬 for문 문법 알려줘",
  "드래곤볼 손오공 나이",
  "내 노트북 배터리 교체 비용",
  "좋아하는 색깔이 뭐야",
  "기타 코드 잡는 법 알려줘",
  "고양이 사료 추천해줘",
  "삼각함수 미분 공식",
  "제주도 3박4일 여행 코스",
  "리액트 useEffect 사용법",
];

const E = JSON.parse(readFileSync("data/embeddings.json", "utf8"));
if (E.model !== MODEL_EMBED) {
  console.error(`⚠️ 코퍼스가 실 임베딩이 아닙니다 (model=${E.model}). 캘리브레이션은 실 임베딩에서만 의미 있음.`);
  process.exit(1);
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const bestScore = (q: number[]): number => {
  let b = -1;
  for (const it of E.items) { const c = cosine(q, it.v); if (c > b) b = c; }
  return b;
};

const run = async () => {
  const all = [...IN_CORPUS, ...OUT_OF_CORPUS];
  const r = await client.embeddings.create({ model: MODEL_EMBED, input: all, dimensions: EMBED_DIM });
  const vecs = r.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);

  const ins = IN_CORPUS.map((_, i) => bestScore(vecs[i]));
  const outs = OUT_OF_CORPUS.map((_, i) => bestScore(vecs[IN_CORPUS.length + i]));

  const f = (n: number) => n.toFixed(4);
  console.log(`코퍼스: ${E.items.length}건 (${E.model}, dim ${E.dim})\n`);
  console.log("── in-corpus (관련 있음) ──");
  IN_CORPUS.forEach((q, i) => console.log(`  ${f(ins[i])}  ${q}`));
  console.log("── out-of-corpus (범위 밖) ──");
  OUT_OF_CORPUS.forEach((q, i) => console.log(`  ${f(outs[i])}  ${q}`));

  const minIn = Math.min(...ins), maxOut = Math.max(...outs);
  const meanIn = ins.reduce((a, b) => a + b, 0) / ins.length;
  const meanOut = outs.reduce((a, b) => a + b, 0) / outs.length;
  console.log(`\n  in : min=${f(minIn)}  mean=${f(meanIn)}`);
  console.log(`  out: max=${f(maxOut)}  mean=${f(meanOut)}`);
  console.log(`  분리 마진 = ${f(minIn - maxOut)}`);

  if (minIn > maxOut) {
    console.log(`\n  ✅ 완전 분리 가능 → 권장 TAU_MIN ≈ ${f((minIn + maxOut) / 2)}`);
  } else {
    // 겹침: in-corpus를 놓치지 않는 선에서(최저 in 아래) 가능한 높게 잡아 명백한 junk만 컷
    const safe = Math.floor((minIn - 0.02) * 100) / 100;
    const cut = outs.filter((o) => o < safe).length;
    console.log(`\n  ⚠️ 분포가 겹침 — 단일 임계치로 완전 분리 불가.`);
    console.log(`     (종합 뉴스 코퍼스는 어떤 질문이든 기저 유사도가 높음)`);
    console.log(`  → 권장 TAU_MIN = ${f(safe)} (in-corpus 전부 통과, out ${cut}/${outs.length} 차단)`);
    console.log(`  → 나머지 out-of-corpus는 2차 게이트(LLM이 근거를 인용 못하면 no_result)로 처리`);
  }
};
run().catch((e) => { console.error(e.message); process.exit(1); });
