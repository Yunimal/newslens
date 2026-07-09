// app/api/ask/lib/sse.ts
// /api/ask?stream=1 의 SSE(Server-Sent Events) 이벤트 인코더. (순수 모듈)
//
// 모든 이벤트는 `data: <json>\n\n` 한 줄로 전송하고, JSON의 `type`으로 구분한다.
// 델타 텍스트를 JSON 인코딩하므로 개행이 섞여도 안전하다. 프론트(D)는 각 data 라인을
// JSON.parse 해서 type별로 처리하면 된다.
//
//   { "type": "meta",    "no_result": false }   // 판정 이벤트. **2번 온다** (아래 규칙 참고)
//   { "type": "token",   "text": "..." }         // 답변 델타(여러 번)
//   { "type": "sources", "source_ids": ["a0001"] }  // 인용된 근거 id (토큰 종료 후 1회)
//   { "type": "error", "code": "rate_limit"|"error", "error": "..." }  // 스트리밍 중 오류(상태코드 이미 200)
//   { "type": "done" }                            // 종료 마커(항상 마지막)
//
// ⚠️ 판정 규칙 — **마지막 meta가 최종 판정**이다.
//   1회차 meta(스트리밍 시작 전): 1단 게이트(코사인 검색) 결과 = 잠정 판정
//   2회차 meta(토큰·sources 이후): 2단 게이트(LLM이 근거를 인용했는가) 결과 = 최종 판정
//   최종 no_result:true 면 프론트는 스트리밍된 본문을 버리고 "관련 기사 없음" 안내문을 표시한다.
//   (관심사 분리: meta = 판정, sources = 인용 목록)

export type SseEvent =
  | { type: "meta"; no_result: boolean }
  | { type: "token"; text: string }
  | { type: "sources"; source_ids: string[] }
  | { type: "error"; code: "rate_limit" | "error"; error: string }
  | { type: "done" };

export function encodeSse(ev: SseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}
