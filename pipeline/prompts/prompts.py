"""
pipeline/prompts/prompts.py — LLM 배치 분석 프롬프트 (B 여운혁 → A 강재구 전달용)

대상 모델: gpt-4o-mini / 언어: 한국어 / 출처: 연합뉴스
- 03_enrich: 기사 1건당 enrichment (summary3, topic_tags, sentiment, keywords, entities)
- 04_embed:  군집 1개당 labeling (label, summary, keywords)

권장 호출 파라미터:
    temperature=0.2, seed=42 (재현성), response_format=아래 *_RESPONSE_FORMAT,
    max_tokens: enrich 700 / cluster 500

⚠️ LLM은 frozen schema의 "부분집합"만 생성한다.
   id/title/url/press/published_at/category/cluster_id/x/y 는 파이프라인이 채우며,
   cluster의 id/size/centroid/sentiment_dist 도 계산값이다(LLM 생성 금지).
   strict json_schema가 추가 키를 구조적으로 차단하지만, 최종 게이트는 반드시
   frozen 스키마 검증기(pydantic)다. 검증 통과분만 산출물에 기록한다.
"""

# 프롬프트 버전 — 캐시 키에 포함. 프롬프트 수정 시 값 증가 → 캐시 자동 무효화.
ENRICH_PROMPT_VERSION = "enrich_v1"
CLUSTER_PROMPT_VERSION = "cluster_v1"


# ─────────────────────────────────────────────────────────────────────────────
# PART 1 — 03_enrich (기사 1건당)
# ─────────────────────────────────────────────────────────────────────────────

ENRICH_SYSTEM_PROMPT = """당신은 한국어 뉴스를 분석하는 리서치 애널리스트입니다. 연합뉴스 기사 한 건의 제목과 본문을 입력받아, 검색·집계·시각화에 사용할 구조화된 메타데이터를 생성합니다.

[출력 형식 규칙]
1. 반드시 하나의 JSON 객체만 출력합니다. 코드블록 표시, 설명, 주석, 앞뒤 인사말을 절대 붙이지 마세요. 지정된 스키마의 필드 외에는 어떤 키도 추가하지 마세요.
2. 모든 텍스트 값은 한국어로 작성합니다.
3. 저작권 보호를 위해 본문 문장을 그대로 복사·인용하면 안 됩니다. summary3는 반드시 당신의 표현으로 다시 쓴(paraphrase) 문장이어야 하며, 본문 문장을 통째로 옮기지 마세요.
4. 본문에 근거가 없는 사실·숫자·인물·기관·지명을 지어내지 마세요(hallucination 금지). 확실하지 않은 정보는 포함하지 않습니다.

[필드 정의]
- summary3: 기사 핵심을 담은 "정확히 3개"의 한국어 문장 배열. 각 문장은 마침표로 끝나는 완결된 문장이어야 합니다. 권장 구성 = (1) 핵심 사실, (2) 배경·세부, (3) 전망·영향 또는 추가 맥락. 세 문장이 서로 중복되지 않게 작성합니다. 반드시 3개, 더도 덜도 안 됩니다.
- topic_tags: 기사를 분류하는 1~3개의 짧은 한국어 상위 주제 태그(예: "통화정책", "미국 대선", "반도체"). 고유명사 나열이 아니라 분류용 상위 주제여야 합니다.
- sentiment: 기사가 다루는 "주요 대상(main subject)"에 대한 기사의 논조(tone)를 판단합니다. 사건의 사회적 좋고 나쁨이 아니라, 기사가 그 대상을 어떤 논조로 서술하는지를 봅니다.
    * pos: 대상에 우호적·긍정적 논조 (성과, 호전, 수혜, 기대, 성공 등).
    * neu: 뚜렷한 평가 없이 사실을 전달하는 논조 (스트레이트 보도 대부분).
    * neg: 대상에 비판적·부정적 논조 (논란, 악화, 피해, 우려, 의혹, 책임 추궁 등).
  판단이 애매하면 기본값은 neu입니다. 연합뉴스 스트레이트 기사는 대체로 neu입니다.
- keywords: 검색·집계에 쓸 3~5개 핵심 키워드. 명사(구) 중심, 기사 특징을 드러내는 단어로. "관련", "이슈", "오늘" 같은 일반어는 피합니다.
- entities: 본문에 "실제로 등장하는" 고유명사만 추출합니다. 각 항목은 {name, type} 형태.
    * PER: 사람 이름 (예: 윤석열, 이재명, 손흥민)
    * ORG: 조직·기관·기업·정당·언론사 (예: 삼성전자, 국민의힘, 한국은행, 국회)
    * LOC: 지명·국가·지역 (예: 서울, 미국, 부산, 강남구)
  규칙:
    - 일반명사(대통령, 정부, 회사, 시민, 당국 등)는 제외하고 고유명사만 넣습니다.
    - 직책·수식어가 붙으면 이름만 name으로 씁니다(예: "이재명 대표" → name:"이재명", type:"PER").
    - 같은 개체는 한 번만 넣습니다(중복 제거). 표기가 다른 같은 개체는 가장 대표적인 정식 명칭으로 통일하되, 확신이 없으면 본문에 나온 표기를 그대로 씁니다.
    - 해당하는 고유명사가 없으면 빈 배열 []을 반환합니다.
    - 관련성이 낮거나 확신이 없는 개체는 넣지 않습니다."""

ENRICH_USER_TEMPLATE = """다음은 연합뉴스 기사입니다. 지정된 JSON 스키마에 맞춰 분석 결과만 출력하세요.

제목: {title}

본문:
{body}"""

# 본문이 매우 길면 A 쪽에서 앞부분 ~4,000자로 잘라 넣어도 무방(요약·논조에는 충분, 토큰 절감).

ENRICH_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "article_enrichment",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "summary3": {
                    "type": "array",
                    "description": "정확히 3개의 한국어 요약 문장",
                    "items": {"type": "string"},
                    "minItems": 3,
                    "maxItems": 3,
                },
                "topic_tags": {
                    "type": "array",
                    "description": "1~3개의 한국어 상위 주제 태그",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 3,
                },
                "sentiment": {
                    "type": "string",
                    "description": "기사 주요 대상에 대한 논조",
                    "enum": ["pos", "neu", "neg"],
                },
                "keywords": {
                    "type": "array",
                    "description": "3~5개의 한국어 핵심 키워드",
                    "items": {"type": "string"},
                    "minItems": 3,
                    "maxItems": 5,
                },
                "entities": {
                    "type": "array",
                    "description": "본문에 등장하는 고유명사. 없으면 빈 배열",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "name": {"type": "string"},
                            "type": {"type": "string", "enum": ["PER", "ORG", "LOC"]},
                        },
                        "required": ["name", "type"],
                    },
                },
            },
            "required": ["summary3", "topic_tags", "sentiment", "keywords", "entities"],
        },
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# PART 2 — 04_embed (군집 1개당 라벨링)
# ─────────────────────────────────────────────────────────────────────────────

CLUSTER_SYSTEM_PROMPT = """당신은 한국어 뉴스 이슈를 종합·요약하는 리서치 애널리스트입니다. 하나의 군집(cluster)에 속한 여러 기사의 제목과 요약을 입력받아, 그 군집이 공통으로 다루는 이슈를 대표하는 라벨과 요약을 생성합니다.

[규칙]
1. 반드시 하나의 JSON 객체만 출력합니다. 그 외 텍스트·코드블록·주석 금지. 스키마에 없는 키를 추가하지 마세요.
2. 모든 값은 한국어로 작성합니다.
3. 입력된 기사들에 실제로 공통으로 나타나는 주제만 반영합니다. 개별 기사 한 건에만 있는 지엽적 내용이나, 입력에 없는 내용을 지어내지 마세요.

[필드]
- label: 이 군집을 한눈에 보여주는 짧은 이슈명. 8~20자 내외의 명사구 형태(예: "부동산 PF 부실 우려", "미 대선 후보 TV토론"). 특정 기사 제목 하나를 그대로 복사하지 말고, 군집 전체를 아우르는 이름을 지으세요.
- summary: 군집 전체가 다루는 내용을 종합한 2~3개의 한국어 문장. 개별 기사 나열이 아니라 공통 이슈를 요약합니다.
- keywords: 군집을 대표하는 3~5개의 핵심 키워드(명사 중심)."""

CLUSTER_USER_TEMPLATE = """아래는 같은 군집으로 묶인 연합뉴스 기사들의 제목과 요약입니다.
이 군집을 대표하는 라벨·요약·키워드를 지정된 JSON 스키마에 맞춰 출력하세요.

{items}"""

# {items} 포맷 예 (A가 조립, 군집 중심에 가까운 기사 8~12건 샘플링):
#   [1] 제목: ...
#       요약: summary3를 공백으로 이어붙이거나 첫 문장만
#   [2] 제목: ...
#       요약: ...

CLUSTER_RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "cluster_labeling",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "label": {"type": "string", "description": "군집을 대표하는 짧은 한국어 이슈명"},
                "summary": {"type": "string", "description": "군집 전체를 종합한 2~3개 한국어 문장"},
                "keywords": {
                    "type": "array",
                    "description": "3~5개의 한국어 핵심 키워드",
                    "items": {"type": "string"},
                    "minItems": 3,
                    "maxItems": 5,
                },
            },
            "required": ["label", "summary", "keywords"],
        },
    },
}
# 주의: frozen clusters[].summary 는 "2~3문장"이지만 JSON 타입은 단일 string(배열 아님).
#       문장 개수(2~3) 준수는 후처리/검증기에서 확인.


# ─────────────────────────────────────────────────────────────────────────────
# 참고: OpenAI Python SDK 호출 예 (A가 03_enrich에서)
# ─────────────────────────────────────────────────────────────────────────────
#
#   from openai import OpenAI
#   client = OpenAI()
#   resp = client.chat.completions.create(
#       model="gpt-4o-mini",
#       temperature=0.2,
#       seed=42,
#       max_tokens=700,
#       response_format=ENRICH_RESPONSE_FORMAT,
#       messages=[
#           {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
#           {"role": "user", "content": ENRICH_USER_TEMPLATE.format(title=title, body=body)},
#       ],
#   )
#   data = json.loads(resp.choices[0].message.content)
#   # data → {summary3, topic_tags, sentiment, keywords, entities}
#   # 이후 id/title/url/press/published_at/category 등과 병합 → pydantic 검증 → articles.json
