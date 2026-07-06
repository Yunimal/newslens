// app/api/ask/lib/openai.ts
// 서버 전용 OpenAI 래퍼. 클라이언트 싱글턴 + 질의 임베딩 + 챗 생성.
// API 키를 다루므로 server-only.

import "server-only";
import OpenAI from "openai";
import { hashEmbed } from "./embed-core";
import {
  CHAT_MAX_TOKENS,
  CHAT_TEMPERATURE,
  CHAT_TIMEOUT_MS,
  EMBED_DIM,
  EMBED_TIMEOUT_MS,
  HASH_EMBED_MODEL,
  MODEL_CHAT,
  MODEL_EMBED,
  OPENAI_MAX_RETRIES,
} from "./config";

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

const apiKey = (): string | undefined => process.env.OPENAI_API_KEY;
export const hasKey = (): boolean => Boolean(apiKey());

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: apiKey(), maxRetries: OPENAI_MAX_RETRIES });
  return client;
}

/**
 * 질의 임베딩. **코퍼스가 어떤 임베더로 만들어졌는지(corpusModel)에 맞춰** 질의도 같은
 * 공간에서 임베딩한다 — 두 벡터 공간이 어긋나 조용히 no_result가 나는 것을 방지(리뷰 #1/#6).
 *  - corpusModel === HASH_EMBED_MODEL → 해시 폴백(키 유무 무관).
 *  - 그 외(실 임베딩 코퍼스) → 반드시 키로 text-embedding-3-small. 키 없으면 명확히 실패(loud).
 */
export async function embedQuery(text: string, corpusModel: string): Promise<number[]> {
  if (corpusModel === HASH_EMBED_MODEL) return hashEmbed(text);
  // 실 임베딩 코퍼스라면 질의도 "정확히 같은 모델"로 임베딩해야 한다. 다른 모델이면 벡터 공간이
  // 달라 조용히 오작동하므로 명확히 실패시킨다(리뷰2 #1). 해시 vs 실 구분만으론 부족.
  if (corpusModel !== MODEL_EMBED) {
    throw new Error(
      `embed_config_error: 코퍼스 임베딩 모델(${corpusModel})이 질의 임베더(${MODEL_EMBED})와 다릅니다. ` +
        `같은 모델로 코퍼스를 재생성하거나 질의 임베더를 맞추세요.`,
    );
  }
  if (!hasKey()) {
    throw new Error(
      `embed_config_error: 코퍼스(${corpusModel})는 실 임베딩인데 OPENAI_API_KEY가 없습니다. ` +
        `키를 설정하거나 해시 mock 코퍼스를 사용하세요.`,
    );
  }
  const r = await getClient().embeddings.create(
    { model: MODEL_EMBED, input: text, dimensions: EMBED_DIM },
    { timeout: EMBED_TIMEOUT_MS },
  );
  return r.data[0].embedding.map(round4);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** gpt-4o-mini 브리핑 생성(비스트리밍). 반환은 답변 텍스트. */
export async function chat(messages: ChatMessage[]): Promise<string> {
  const r = await getClient().chat.completions.create(
    {
      model: MODEL_CHAT,
      messages,
      temperature: CHAT_TEMPERATURE,
      max_tokens: CHAT_MAX_TOKENS,
    },
    { timeout: CHAT_TIMEOUT_MS },
  );
  const choice = r.choices[0];
  if (choice?.message?.refusal) throw new Error(`model_refusal: ${choice.message.refusal}`);
  return choice?.message?.content ?? "";
}

/**
 * gpt-4o-mini 스트리밍 생성. 델타 텍스트를 순차 yield. (route가 SSE로 흘림)
 * signal: 클라이언트 이탈 시 상위 OpenAI 생성을 중단(비용/행 방지, 리뷰2 #5).
 * 모델 거부(refusal)는 throw해 비스트리밍 chat()과 동작을 맞춘다(리뷰2 #7/#9/#12).
 */
export async function* chatStream(
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const stream = await getClient().chat.completions.create(
    {
      model: MODEL_CHAT,
      messages,
      temperature: CHAT_TEMPERATURE,
      max_tokens: CHAT_MAX_TOKENS,
      stream: true,
    },
    { timeout: CHAT_TIMEOUT_MS, signal },
  );
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (choice?.delta?.refusal) throw new Error(`model_refusal: ${choice.delta.refusal}`);
    const delta = choice?.delta?.content ?? "";
    if (delta) yield delta;
  }
}

/** OpenAI 429(RateLimit) 판별 → route에서 사용자용 429 응답으로 매핑 */
export function isRateLimit(e: unknown): boolean {
  return e instanceof OpenAI.APIError && e.status === 429;
}
