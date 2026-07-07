// app/api/ask/lib/retrieve.ts
// 검색 오케스트레이션: 질의문 구성 → 임베딩 → 코사인 top-k → 임계치 게이트.
// 서버 전용(data/openai import).

import "server-only";
import { getCorpus } from "./data";
import { embedQuery } from "./openai";
import { topK } from "./similarity";
import {
  HASH_EMBED_MODEL,
  MAX_QUERY_CHARS,
  MAX_TURN_CHARS,
  TAU_CTX,
  TAU_CTX_HASH,
  TAU_MIN,
  TAU_MIN_HASH,
  TOP_K,
} from "./config";
import type { Hit } from "./prompt";
import type { ChatTurn } from "@/types/schema";

export interface Retrieval {
  hits: Hit[];
  best: number; // 최고 코사인 유사도 (튜닝/디버깅용)
  noResult: boolean; // best < TAU_MIN → true
  usingMock: boolean;
}

/**
 * 임베딩할 질의문 구성. **질문을 먼저** 넣어 절대 잘려나가지 않게 하고(리뷰 #4),
 * focus 기사 제목·직전 user 발화는 남은 예산 안에서만 덧붙이는 보조 편향 신호.
 */
function buildQueryText(question: string, history: ChatTurn[], focusTitle?: string): string {
  const q = question.slice(0, MAX_QUERY_CHARS);
  const parts = [q];
  let remaining = MAX_QUERY_CHARS - q.length;

  const append = (s?: string) => {
    if (!s || remaining <= 1) return;
    const clipped = s.slice(0, Math.min(remaining - 1, MAX_TURN_CHARS));
    if (clipped) {
      parts.push(clipped);
      remaining -= clipped.length + 1; // + 개행
    }
  };
  append(focusTitle);
  const lastUser = [...history].reverse().find((t) => t.role === "user");
  append(lastUser?.content);

  return parts.join("\n");
}

export interface RetrieveOpts {
  history?: ChatTurn[];
  focusArticleId?: string;
}

export async function retrieve(question: string, opts: RetrieveOpts = {}): Promise<Retrieval> {
  const corpus = await getCorpus();
  const focusTitle = opts.focusArticleId ? corpus.byId.get(opts.focusArticleId)?.title : undefined;
  const queryText = buildQueryText(question, opts.history ?? [], focusTitle);

  // 질의 임베더와 임계치를 **코퍼스 provenance**에 결합(리뷰 #1) — 코퍼스가 해시 공간이면
  // 질의도 해시로, 임계치도 해시용을 쓴다. 두 벡터 공간이 어긋나 조용히 no_result 나는 것 방지.
  const isHash = corpus.embedModel === HASH_EMBED_MODEL;
  const qv = await embedQuery(queryText, corpus.embedModel);
  const scored = topK(
    qv,
    corpus.vectors.map((v) => ({ vec: v.vec, norm: v.norm, ref: v.id })),
    TOP_K,
  );

  const tauMin = isHash ? TAU_MIN_HASH : TAU_MIN;
  const tauCtx = isHash ? TAU_CTX_HASH : TAU_CTX;

  const best = scored[0]?.score ?? 0;
  if (best < tauMin) {
    return { hits: [], best, noResult: true, usingMock: corpus.usingMock };
  }

  const hits: Hit[] = scored
    .filter((s) => s.score >= tauCtx)
    .map((s) => ({ article: corpus.byId.get(s.ref), score: s.score }))
    .filter((h): h is Hit => Boolean(h.article));

  return { hits, best, noResult: hits.length === 0, usingMock: corpus.usingMock };
}
