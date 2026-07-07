// app/api/ask/route.ts
// POST /api/ask — RAG 브리핑 엔드포인트.
// 흐름: 검증 → 검색(임베딩+코사인 top-k) → 임계치 게이트 → (챗 | no_result) → 응답 정형.
// 기본 응답은 JSON(AskResponse). ?stream=1 이면 동일 파이프라인을 SSE로 스트리밍(Day 4).
// 비용 가드: 요청당 임베딩 1회 + 챗 ≤1회. 임계치 미달이면 챗 호출 0회.

import { retrieve } from "./lib/retrieve";
import { chat, chatStream, hasKey, isRateLimit, type ChatMessage } from "./lib/openai";
import {
  OUT_OF_SCOPE_NOTICE,
  SYSTEM_PROMPT,
  buildUserMessage,
  devModeAnswer,
  extractSourceIds,
  type Hit,
} from "./lib/prompt";
import { encodeSse, type SseEvent } from "./lib/sse";
import { MAX_HISTORY_TURNS, MAX_QUERY_CHARS, MAX_TURN_CHARS } from "./lib/config";
import type { AskRequest, AskResponse, ChatTurn } from "@/types/schema";

export const runtime = "nodejs";
// 초. worst-case = embed(8s×2 attempts) + chat(20s×2) = 56s < 60. (config.ts 재시도 수와 맞춤, 리뷰 #5)
// Vercel Hobby 상한이 60s이므로 60으로 고정. 정상 경로는 수 초.
export const maxDuration = 60;

const json = (body: AskResponse | { error: string }, status = 200) =>
  Response.json(body, { status });

/**
 * SSE 응답 빌더. producer가 (emit, signal)로 이벤트를 흘린다. 클라이언트 이탈에 안전:
 * emit은 닫힌 컨트롤러에서 no-op, cancel()·요청 abort 시 signal로 상위 생성을 중단(리뷰2 #2/#5/#13),
 * 오류는 rate_limit을 구분해 error 이벤트로 알린다(#3). 정상 이탈은 서버 에러로 로깅하지 않는다.
 */
function sse(
  reqSignal: AbortSignal | undefined,
  producer: (emit: (ev: SseEvent) => void, signal: AbortSignal) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const ac = new AbortController();
  if (reqSignal) reqSignal.addEventListener("abort", () => ac.abort(), { once: true });
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(ev)));
        } catch {
          closed = true; // 컨트롤러가 이미 닫힘(클라이언트 이탈) → 이후 emit 무시
        }
      };
      try {
        await producer(emit, ac.signal);
      } catch (e) {
        // 클라이언트 이탈로 인한 abort는 정상 상황 → 로깅·error 이벤트 생략
        if (!ac.signal.aborted && !closed) {
          const rate = isRateLimit(e);
          console.error("[/api/ask stream]", e);
          emit({
            type: "error",
            code: rate ? "rate_limit" : "error",
            error: rate
              ? "요청이 많습니다. 잠시 후 다시 시도해 주세요."
              : "일시적인 오류가 발생했습니다. 다시 시도해 주세요.",
          });
        }
      } finally {
        emit({ type: "done" });
        closed = true;
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 — no-op */
        }
      }
    },
    cancel() {
      closed = true;
      ac.abort(); // 클라이언트가 스트림 취소 → 상위 OpenAI 생성 중단(비용/행 방지)
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no", // 프록시 버퍼링 방지
    },
  });
}

/** 클라이언트가 보낸 history를 신뢰하지 않고 정제: 역할 enum·길이·턴수 제한.
 *  뒤에서부터 최대 MAX_HISTORY_TURNS개만 수집해 거대한 배열도 O(턴수)로 처리(리뷰2 #11). */
function sanitizeHistory(h: unknown): ChatTurn[] {
  if (!Array.isArray(h)) return [];
  const out: ChatTurn[] = [];
  for (let i = h.length - 1; i >= 0 && out.length < MAX_HISTORY_TURNS; i--) {
    const t = h[i];
    if (!t || (t.role !== "user" && t.role !== "assistant") || typeof t.content !== "string") continue;
    const content = t.content.trim().slice(0, MAX_TURN_CHARS);
    if (!content) continue; // 빈 발화 제외
    out.push({ role: t.role, content });
  }
  return out.reverse();
}

function buildMessages(hits: Hit[], question: string, history: ChatTurn[]): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history,
    { role: "user", content: buildUserMessage(hits, question) },
  ];
}

export async function POST(req: Request) {
  const wantStream = new URL(req.url).searchParams.get("stream") === "1";

  // 1) 파싱·검증
  let body: AskRequest;
  try {
    body = (await req.json()) as AskRequest;
  } catch {
    return json({ error: "잘못된 요청 형식입니다." }, 400);
  }
  // 타입 검증 후 캡 — 비문자열이면 400(500 아님), 과도한 길이는 잘라 비용/DoS 가드(리뷰 #7/#10)
  const raw = typeof body?.question === "string" ? body.question.trim() : "";
  if (!raw) return json({ error: "질문을 입력해 주세요." }, 400);
  const question = raw.slice(0, MAX_QUERY_CHARS);

  const history = sanitizeHistory(body.history);

  try {
    // 2) 검색 + 임계치 게이트 (스트리밍 시작 전에 수행 → 여기서의 오류는 정상 JSON 상태코드로)
    const { hits, noResult } = await retrieve(question, {
      history,
      focusArticleId: body.focus_article_id,
    });

    // 2-a) 범위 밖
    if (noResult || hits.length === 0) {
      if (wantStream) {
        return sse(req.signal, async (emit) => {
          emit({ type: "meta", no_result: true });
          emit({ type: "token", text: OUT_OF_SCOPE_NOTICE });
          emit({ type: "sources", source_ids: [] });
        });
      }
      return json({ answer: OUT_OF_SCOPE_NOTICE, source_ids: [], no_result: true });
    }

    // 2-b) 키 없음
    if (!hasKey()) {
      // 기본적으로 production에서는 설정 누락을 시끄럽게 실패시킨다.
      // 단, mock 데이터로 공개 데모/서빙을 해야 하는 경우 명시 플래그로 개발모드 답변을 허용한다.
      const allowDevAnswer = process.env.NEWSLENS_ALLOW_DEV_ANSWER === "1";
      if (process.env.NODE_ENV === "production" && !allowDevAnswer) {
        console.error("[/api/ask] OPENAI_API_KEY 미설정 (production)");
        return json({ error: "일시적인 오류가 발생했습니다. 다시 시도해 주세요." }, 500);
      }
      // 개발/데모 모드: 검색 결과만 반환 → 키 없이도 프론트 E2E(스트리밍 포함) 테스트 가능
      const ids = hits.map((h) => h.article.id);
      const answer = devModeAnswer(ids);
      if (wantStream) {
        return sse(req.signal, async (emit) => {
          emit({ type: "meta", no_result: false });
          emit({ type: "token", text: answer });
          emit({ type: "sources", source_ids: ids });
        });
      }
      return json({ answer, source_ids: ids, no_result: false });
    }

    // 2-c) 브리핑 생성
    const messages = buildMessages(hits, question, history);
    const allowed = new Set(hits.map((h) => h.article.id));

    if (wantStream) {
      return sse(req.signal, async (emit, signal) => {
        emit({ type: "meta", no_result: false });
        let full = "";
        for await (const delta of chatStream(messages, signal)) {
          full += delta;
          emit({ type: "token", text: delta });
        }
        // 전문 버퍼로 인용 추출 → 컨텍스트에 넣은 id만(환각 제거)
        emit({ type: "sources", source_ids: extractSourceIds(full, allowed) });
      });
    }

    const answer = await chat(messages);
    const source_ids = extractSourceIds(answer, allowed);
    return json({ answer, source_ids, no_result: false });
  } catch (e) {
    // 스트리밍 시작 전(검색 등)의 오류만 여기로 온다. 스트리밍 중 오류는 sse() 내부에서 처리.
    if (isRateLimit(e)) {
      return json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요." }, 429);
    }
    console.error("[/api/ask]", e);
    return json({ error: "일시적인 오류가 발생했습니다. 다시 시도해 주세요." }, 500);
  }
}
