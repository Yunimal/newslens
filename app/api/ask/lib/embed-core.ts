// app/api/ask/lib/embed-core.ts
// 순수(PURE) 모듈 — 'server-only' 없음, 외부 네트워크 없음.
// 런타임(route)과 node 스크립트(mock 생성·스모크 테스트)가 함께 import.
//
// OPENAI_API_KEY가 없을 때 사용하는 결정적(deterministic) 폴백 임베더.
// feature-hashing bag-of-words 방식이라 토큰이 겹치는 텍스트끼리 코사인 유사도가
// 올라간다 → 키 없이도 검색이 "의미 있게" 동작하므로 오프라인 개발/검증에 사용.
// 실제 키가 있으면 lib/openai.ts가 text-embedding-3-small(dim 512)로 대체한다.

import { EMBED_DIM } from "./config";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** FNV-1a 32-bit 해시 */
function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 단어 + 각 단어의 문자 bigram (한국어 부분 겹침을 잡기 위함) */
function tokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .filter((w) => w.length > 0);
  const grams: string[] = [...words];
  for (const w of words) {
    for (let i = 0; i < w.length - 1; i++) grams.push(w.slice(i, i + 2));
  }
  return grams;
}

/**
 * 결정적 폴백 임베딩. 정규화된 512차원 벡터를 반환.
 * 같은 입력 → 항상 같은 벡터(idempotent). 토큰 겹침이 많을수록 코사인이 커진다.
 */
export function hashEmbed(text: string, dim: number = EMBED_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const tok of tokens(text)) {
    const h = hash32(tok);
    const idx = h % dim;
    // 별도 salt 해시로 부호 결정 → idx와 상관관계를 낮춰 충돌 완화
    const sign = hash32("s#" + tok) & 1 ? 1 : -1;
    v[idx] += sign;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => round4(x / norm));
}
