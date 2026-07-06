# `/api/ask` — AI 뉴스 리서처 백엔드 (RAG)

> 담당: **B 여운혁 (AI/백엔드)** · 브랜치 `backend_yeo`
> 한 줄 요약: **질문을 받으면, 수집된 뉴스에서 근거 기사를 찾아 인용까지 붙인 브리핑을 돌려주는** 서버리스 RAG 엔드포인트.

사용자가 자연어로 물으면 → 관련 기사를 임베딩 유사도로 검색하고(RAG의 R) → 그 기사들만 근거로
gpt-4o-mini가 브리핑을 생성한다(RAG의 G). 답변엔 `[a0013]` 형식의 인라인 인용이 붙고, 프론트는
그 id로 근거 기사 카드를 렌더링한다.

---

## 1. 큰 그림 — "무거운 건 오프라인, 런타임은 서버리스"

```
┌─ 오프라인 파이프라인 (A 강재구, 로컬 1회 실행) ──────────────────────────┐
│  RSS 수집 → 전처리 → LLM 배치(분류·논조·요약·엔티티) → 임베딩 → UMAP 좌표  │
│  프롬프트/스키마는 B가 제공: pipeline/prompts/prompts.py                  │
│  산출물: data/articles.json  +  data/embeddings.json (512차원)            │
└──────────────────────────────────────────────────────────────────────────┘
                                   │  (정적 JSON)
                                   ▼
┌─ 런타임 (B 여운혁, Vercel 서버리스) ──────────────────────────────────────┐
│  POST /api/ask                                                            │
│    질문 → 임베딩 1회 → 코사인 top-k → 임계치 게이트 → gpt-4o-mini 브리핑    │
│    → { answer(인용 포함), source_ids, no_result }                         │
│  DB 없음. 1,000건 규모 벡터는 함수 메모리에서 코사인으로 충분.             │
└──────────────────────────────────────────────────────────────────────────┘
```

이 엔드포인트는 A의 실데이터가 없어도 **mock 데이터로 전부 동작**하도록 만들어졌다(§5). 그래서
B는 A를 기다리지 않고 백엔드를 완성할 수 있고, D는 키 없이도 챗 UI를 붙여볼 수 있다.

---

## 2. 요청 한 건의 생애 (request lifecycle)

```
POST /api/ask  { question, history?, focus_article_id? }
   │
   1. 검증        질문 비었으면 400 · JSON 깨졌으면 400
   │             history 정제(역할 enum·길이·최대 3턴)
   │
   2. 질의문 구성  [focus 기사 제목] + [직전 user 발화] + question   (합쳐서 ~500자 캡)
   │
   3. 임베딩 1회   text-embedding-3-small(dim 512)  |  키 없으면 해시 폴백
   │
   4. 코사인 top-k corpus 전 벡터와 코사인 → 상위 K(=6)
   │
   5. 임계치 게이트  best < τ_min ?  ──yes──▶  no_result=true, 챗 호출 0회  (비용 가드)
   │                      │no
   6. 브리핑 생성   gpt-4o-mini(system=리서처 페르소나, user=<근거 기사>+질문)  ≤1회
   │             키 없으면 "개발 모드" 답변(검색 결과만) 반환
   │
   7. 인용 추출    답변의 [aXXXX] 중 컨텍스트에 실제로 넣은 id만 → source_ids (환각 id 제거)
   │
   ▼
{ answer, source_ids, no_result }        오류 시 429/500 { error }
```

**비용 가드(핵심 불변식)**: 요청당 임베딩 **1회 + 챗 ≤1회**. 임계치 미달이면 챗 **0회**.
에이전트 루프·재임베딩·툴 라운드트립 없음. 컨텍스트는 최대 6건 × 3문장 요약으로 제한.

---

## 3. 파일 지도

```
types/schema.ts                 프론트·백 공유 계약(FROZEN). Article/Cluster/AskRequest/AskResponse 등
app/api/ask/
  route.ts                      POST 핸들러. 검증→검색→게이트→(챗|no_result)→정형. runtime=nodejs, maxDuration=30
  lib/
    config.ts                   모든 튜너블 상수(모델·K·임계치·타임아웃·히스토리 캡)
    embed-core.ts   [순수]       해시 폴백 임베더(feature-hashing). 스크립트도 import
    similarity.ts   [순수]       cosine() · topK(). I/O 없음 → 단위 테스트 대상
    prompt.ts       [순수]       리서처 시스템 프롬프트, 컨텍스트 조립, 인용 추출
    data.ts         [server]     articles+embeddings 로더(캐시·mock/real 선택). server-only
    openai.ts       [server]     OpenAI 싱글턴, embedQuery(), chat(), isRateLimit(). server-only
    retrieve.ts     [server]     검색 오케스트레이션(질의문→임베딩→topK→게이트)
scripts/
  generate-mock-data.ts         data/*.mock.json 생성(스키마 준수 30건). npm run gen:mock
  smoke-retrieve.ts             오프라인 검색 스모크 테스트. npm run smoke:retrieve
data/
  articles.mock.json            커밋되는 가짜 데이터(스키마 valid)
  embeddings.mock.json          커밋되는 가짜 벡터(dim 512)
pipeline/prompts/               A에게 넘기는 배치 분석 프롬프트+스키마(prompts.py, README.md)
```

`[순수]` 모듈은 `server-only`을 import하지 않아 node 스크립트(tsx)에서도 쓸 수 있다.
`[server]` 모듈은 API 키·벡터를 다루므로 `import "server-only"`로 클라이언트 번들 유입을 원천 차단한다.

---

## 4. 검색 임계치 (threshold)

| 상수 | 실 임베딩 | 해시 폴백 | 뜻 |
| --- | --- | --- | --- |
| `TAU_MIN` | 0.30 | 0.15 | 최고 유사도가 이 값 미만이면 `no_result`(챗 스킵) |
| `TAU_CTX` | 0.20 | 0.10 | 컨텍스트에 넣을 최소 유사도(약한 꼬리 제거) |
| `TOP_K` | 6 | 6 | 컨텍스트로 넘길 최대 근거 기사 수 |

두 임베더는 코사인 절대 스케일이 달라 임계치를 분리했다(`retrieve.ts`가 `hasKey()`로 선택).
**실 임베딩 경로(0.30/0.20)는 A의 실데이터+실키 도착 후** in-corpus / out-of-corpus 질문 픽스처로
재튜닝한다: in-corpus 최저 `best`보다 살짝 아래, out-of-corpus 최고 `best`보다 위.

---

## 5. mock 모드 — A 없이 개발하기

`lib/data.ts`가 어떤 데이터를 읽을지 결정한다:

```
NEWSLENS_USE_MOCK=1              → 항상 data/*.mock.json
그 외 & 실데이터 둘 다 존재       → data/articles.json + embeddings.json
그 외 & 실데이터 없음            → mock 폴백(경고 로그)
```

임베딩도 마찬가지로 **키가 있으면 OpenAI, 없으면 해시 폴백**을 쓴다. 해시 폴백은
feature-hashing bag-of-words 방식이라 **토큰이 겹치는 텍스트끼리 코사인이 올라가**서,
키가 전혀 없어도 검색이 "의미 있게" 동작한다(스모크 테스트가 이걸 검증). mock 생성기와
런타임이 같은 해시 폴백을 쓰므로 양쪽 벡터가 호환된다.

**A의 실데이터가 도착하면** → `data/articles.json`·`embeddings.json`을 넣고
`.env.local`의 `NEWSLENS_USE_MOCK`을 비우면 끝. **코드 변경 0.**

---

## 6. 실행 & 테스트

```bash
# 0) 준비
cp .env.example .env.local      # OPENAI_API_KEY 입력(선택), NEWSLENS_USE_MOCK=1 유지
npm install

# 1) mock 데이터 생성 (키 없으면 해시 임베딩)
npm run gen:mock

# 2) 오프라인 검색 스모크 (키 불필요) — Day 2 산출물 검증
npm run smoke:retrieve

# 3) 타입·린트·단위테스트
npm run typecheck && npm run lint && npm test

# 4) 로컬 서버 + 엔드포인트
npm run dev
curl -s -X POST localhost:3000/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"반도체 수출 요즘 어때?"}'

# 스트리밍(SSE) — meta → token… → sources → done
curl -sN -X POST "localhost:3000/api/ask?stream=1" \
  -H 'Content-Type: application/json' \
  -d '{"question":"반도체 수출 요즘 어때?"}'
```

키가 없으면 `answer`가 "【개발 모드 · LLM 미연결】 …"로 나오고 `source_ids`는 채워진다(검색은 정상).
`.env.local`에 실제 `OPENAI_API_KEY`를 넣으면 같은 요청이 **실제 브리핑**으로 바뀐다.

---

## 7. API 계약 (`types/schema.ts`와 동일)

**요청** `POST /api/ask`
```jsonc
{
  "question": "반도체 수출 요즘 어때?",   // 필수
  "history": [{ "role": "user", "content": "..." }],  // 선택, 최대 3턴
  "focus_article_id": "a0011"            // 선택, 기사 카드 "질문하기" 진입 시
}
```

**응답 200**
```jsonc
{
  "answer": "반도체 수출이 두 자릿수 증가했다[a0013]. AI 서버용 메모리가 실적을 견인했다[a0013].",
  "source_ids": ["a0013"],   // 실제 인용된 id (프론트가 articles.json에서 조회해 카드 렌더링)
  "no_result": false          // true면 answer는 "수집 범위 내 관련 기사 없음" 안내문
}
```

**오류** `429`(요청 과다) / `500`(일시 오류) / `400`(빈 질문·비문자열·깨진 JSON)
```jsonc
{ "error": "요청이 많습니다. 잠시 후 다시 시도해 주세요." }   // 프론트: 안내 + [다시 시도], 입력값 보존
```

### 스트리밍 `POST /api/ask?stream=1` (SSE)

`Content-Type: text/event-stream`. 각 이벤트는 `data: <json>\n\n` 한 줄, JSON의 `type`으로 구분(D는 `type`별 처리):

```
data: {"type":"meta","no_result":false}          // 최초 1회
data: {"type":"token","text":"반도체 수출이…"}    // 답변 델타(여러 번)
data: {"type":"sources","source_ids":["a0013"]}   // 인용된 근거(토큰 종료 후 1회)
data: {"type":"done"}                             // 항상 마지막
// 스트리밍 중 오류: {"type":"error","error":"…"} 후 done (상태코드는 200 고정)
```

임계치 게이트·검색 오류는 **스트리밍 시작 전**에 처리되므로 `no_result`/`429`/`500`은 정상 동작한다.
기본(비스트리밍) JSON 계약은 그대로 유지 — 스트리밍은 순수 추가 기능.

---

## 8. 팀 분담표 대비 진행 상황 (B)

| Day | B 할 일 | 상태 |
| --- | --- | --- |
| 1 | LLM 선정(gpt-4o-mini), 배치 프롬프트, 키·환경변수 | ✅ `pipeline/prompts/` + `schema.ts` + `.env` |
| 2 | `/api/ask` 골격: 질의 임베딩 → 코사인 top-k (LLM 연결 전) | ✅ 검색 E2E 동작(mock) + 스모크 검증 |
| 3 | LLM 답변 생성 연결: 페르소나·인용 강제·범위밖·출처 포맷 | ✅ 코드 완비(인용 추출·게이트) · **키만 꽂으면 브리핑** |
| 4 | 스트리밍, 대화 맥락, 임계치 미달 "관련 기사 없음" | ✅ SSE 스트리밍 + history 맥락 + 게이트 구현·검증 |
| 5 | 예외 처리(재시도·타임아웃·비용 가드) | ✅ 429/500/400 매핑·타임아웃·SDK 재시도·비용 가드·단위테스트 |
| 6 | 발표자료 "시스템 아키텍처·RAG" 파트 | ⬜ (이 문서 + 아키텍처 다이어그램이 초안 재료) |
| 7 | 키·환경변수 최종 점검, 배포 확정 | ⬜ (실키·실데이터 연결 후) |

> 남은 것은 **실 OPENAI_API_KEY 연결**(브리핑 실제 생성)과 **A의 실데이터 연결 후 임계치 재튜닝**뿐.
> 코드는 그 두 가지를 코드 변경 없이 받도록 이미 준비됨(§5, §4).

---

## 9. 안정성 요약 (구현 완료)

- **스트리밍**: `?stream=1` SSE. 서버가 전문을 버퍼해 종료 시 `extractSourceIds`로 `source_ids` 확정.
- **타임아웃**: 임베딩 8s / 챗 20s (SDK per-call timeout). worst-case(재시도 포함) 56s < `maxDuration` 60s.
- **재시도**: OpenAI SDK 내장(429/5xx/네트워크). 소진 후 `RateLimitError`→우리 `429`로 매핑.
- **입력 가드**: 질문 비문자열→400, 질문·history 각 길이 캡, history 최대 3턴, 프롬프트 인젝션 방지 규칙(§prompt.ts).
- **비용 가드**: 요청당 임베딩 1 + 챗 ≤1, 임계치 미달 시 챗 0.
- **테스트**: `npm test`(순수 similarity/embed-core 12케이스), `npm run smoke:retrieve`(검색 E2E).

## 관련 문서

- 데이터 스키마 계약: [`types/schema.ts`](../../../types/schema.ts) (동결)
- 배치 분석 프롬프트(→A): [`pipeline/prompts/`](../../../pipeline/prompts/README.md)
