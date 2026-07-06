// app/api/ask/lib/similarity.ts
// 순수 함수만 — I/O 없음. 유일하게 단위 테스트할 가치가 있는 모듈.

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * 코사인 유사도. 미리 계산한 norm이 있으면 넘겨 재사용(성능).
 * truncated `dimensions` 임베딩은 단위벡터가 보장되지 않으므로 항상 정규화한다.
 */
export function cosine(
  a: number[],
  b: number[],
  aNorm?: number,
  bNorm?: number,
): number {
  const denom = (aNorm ?? norm(a)) * (bNorm ?? norm(b));
  return denom === 0 ? 0 : dot(a, b) / denom;
}

export interface Scored<T> {
  ref: T;
  score: number;
}

export interface Indexed<T> {
  vec: number[];
  norm?: number;
  ref: T;
}

/** query와 items 전체의 코사인을 계산해 상위 k개를 점수 내림차순으로 반환. */
export function topK<T>(query: number[], items: Indexed<T>[], k: number): Scored<T>[] {
  const qn = norm(query);
  const scored = items.map(({ vec, norm: vn, ref }) => ({
    ref,
    score: cosine(query, vec, qn, vn),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
