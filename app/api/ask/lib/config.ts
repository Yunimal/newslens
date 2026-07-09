// app/api/ask/lib/config.ts
// /api/ask RAG 파이프라인의 모든 튜너블 상수 한 곳에 모음. (순수 · server-only 아님)

/** 동결 모델 */
export const MODEL_CHAT = "gpt-4o-mini";
export const MODEL_EMBED = "text-embedding-3-small";
export const EMBED_DIM = 512;

/**
 * 해시 폴백 임베더의 provenance 식별자. embeddings 파일의 `model` 필드에 이 값이 있으면
 * 코퍼스가 해시 공간이라는 뜻 → 질의도 반드시 해시 임베더로 임베딩하고 해시 임계치를 쓴다.
 * (질의 임베더/임계치를 코퍼스 provenance에 결합해, 키 유무와 코퍼스가 어긋나 조용히
 *  no_result가 나는 것을 방지)
 */
export const HASH_EMBED_MODEL = "hash-fallback-v1";

/** 검색(retrieval) */
export const TOP_K = 6; // 컨텍스트로 넘길 최대 근거 기사 수

// 실 임베딩(text-embedding-3-small) 경로 임계치.
// ── 2026-07-08 실데이터(369건) + fixture 10/10 캘리브레이션 결과 (npm run calibrate) ──
//   in-corpus : min 0.3847, mean 0.4305
//   out-corpus: max 0.3872, mean 0.3367   → 분리 마진 -0.0025 (겹침!)
// 종합 뉴스 코퍼스는 어떤 질문이든 기저 유사도가 높아 "단일 코사인 임계치로 범위밖 판별 불가".
// 그래서 2단 게이트를 쓴다:
//   1단(여기): TAU_MIN=0.36 — in-corpus는 전부 통과시키면서 명백한 junk 60%를 챗 호출 0회로 차단
//   2단(route): LLM이 근거를 하나도 인용하지 못하면 no_result 로 판정 (의미 기반 최종 게이트)
export const TAU_MIN = 0.36; // 1단 게이트: 이 값 미만이면 즉시 no_result (챗 스킵)
export const TAU_CTX = 0.3; // 컨텍스트 포함 최소 유사도 (약한 꼬리 제거). TAU_MIN > TAU_CTX 유지

// 해시 폴백 임베더(키 없음, 개발/오프라인)용 임계치 — 절대 코사인 스케일이 낮아 별도 값.
export const TAU_MIN_HASH = 0.15;
export const TAU_CTX_HASH = 0.1;

/** 대화 맥락 / 입력 제한 (비용·프롬프트 인젝션 가드) */
export const MAX_HISTORY_TURNS = 3;
export const MAX_TURN_CHARS = 500;
export const MAX_QUERY_CHARS = 500;

/** 챗 생성 */
export const CHAT_TEMPERATURE = 0.2;
export const CHAT_MAX_TOKENS = 600;

/** OpenAI 호출 안정성.
 *  maxDuration 예산: 요청은 임베딩→챗 순차 실행. SDK 재시도가 per-call timeout을 곱하므로
 *  worst-case = embed(8s×2) + chat(20s×2) = 56s < route maxDuration(60s). retries를 1로 낮춰
 *  재시도 폭주가 함수 한도를 넘지 않게 한다. */
export const EMBED_TIMEOUT_MS = 8_000;
export const CHAT_TIMEOUT_MS = 20_000;
export const OPENAI_MAX_RETRIES = 1; // SDK 내장 지수 백오프 (429/5xx/네트워크). attempts = 1 + retries
