// app/api/ask/lib/sse.ts
// /api/ask?stream=1 의 SSE(Server-Sent Events) 이벤트 인코더. (순수 모듈)
//
// 모든 이벤트는 `data: <json>\n\n` 한 줄로 전송하고, JSON의 `type`으로 구분한다.
// 델타 텍스트를 JSON 인코딩하므로 개행이 섞여도 안전하다. 프론트(D)는 각 data 라인을
// JSON.parse 해서 type별로 처리하면 된다.
//
//   { "type": "meta",    "no_result": false }   // 최초 1회. no_result면 이후 token은 안내문
//   { "type": "token",   "text": "..." }         // 답변 델타(여러 번)
//   { "type": "sources", "source_ids": ["a0001"] }// 인용된 근거 id (토큰 종료 후 1회)
//   { "type": "error",   "error": "..." }         // 스트리밍 중 오류(상태코드는 이미 200 고정)
//   { "type": "done" }                            // 종료 마커(항상 마지막)

export type SseEvent =
  | { type: "meta"; no_result: boolean }
  | { type: "token"; text: string }
  | { type: "sources"; source_ids: string[] }
  | { type: "error"; error: string }
  | { type: "done" };

export function encodeSse(ev: SseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}
