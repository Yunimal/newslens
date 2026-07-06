# pipeline/prompts — LLM 배치 분석 프롬프트 (B → A 전달)

NewsLens 오프라인 파이프라인에서 gpt-4o-mini로 기사/군집을 분석할 때 쓰는 프롬프트와
strict JSON 스키마 모음입니다. **B(여운혁)가 작성**해 A(강재구)의 파이프라인
(`03_enrich`, `04_embed`)에서 그대로 import해 쓰도록 만들었습니다.

## 내용

- `prompts.py`
  - `ENRICH_SYSTEM_PROMPT`, `ENRICH_USER_TEMPLATE`, `ENRICH_RESPONSE_FORMAT` — 기사 1건당
    `summary3 / topic_tags / sentiment / keywords / entities` 생성 (frozen schema의 부분집합).
  - `CLUSTER_SYSTEM_PROMPT`, `CLUSTER_USER_TEMPLATE`, `CLUSTER_RESPONSE_FORMAT` — 군집 1개당
    `label / summary / keywords` 생성.
  - `ENRICH_PROMPT_VERSION`, `CLUSTER_PROMPT_VERSION` — 캐시 키에 포함할 버전 상수.

## 사용 (03_enrich)

```python
import json
from openai import OpenAI
from pipeline.prompts.prompts import (
    ENRICH_SYSTEM_PROMPT, ENRICH_USER_TEMPLATE, ENRICH_RESPONSE_FORMAT,
)

client = OpenAI()
resp = client.chat.completions.create(
    model="gpt-4o-mini", temperature=0.2, seed=42, max_tokens=700,
    response_format=ENRICH_RESPONSE_FORMAT,
    messages=[
        {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
        {"role": "user", "content": ENRICH_USER_TEMPLATE.format(title=title, body=body)},
    ],
)
data = json.loads(resp.choices[0].message.content)   # 5개 필드
# → id/url/press/published_at/category 등과 병합 → pydantic(schemas.py) 검증 → articles.json
```

## 계약·주의사항

- **LLM은 frozen schema의 부분집합만 생성**한다. `id/title/url/press/published_at/category/
  cluster_id/x/y`, 그리고 cluster의 `id/size/centroid/sentiment_dist`는 파이프라인 계산값이며
  LLM이 만들지 않는다 (strict schema가 추가 키를 차단).
- **본문 미저장**: `body`는 LLM 입력으로만 쓰고 즉시 폐기. 산출물엔 `summary3`(paraphrase)와
  `url`만 남긴다 (저작권 정책).
- **최종 게이트는 pydantic 검증기**다. 배열 개수(summary3=3, topic_tags 1~3, keywords 3~5)와
  enum(sentiment, entity.type)을 재확인하고, 실패분은 재시도하거나 실패 목록에 넣어 **제외**한다
  (잘못된 데이터가 client-public 파일에 들어가지 않도록).
- **재현성·재개**: `temperature=0.2, seed=42` 고정. 캐시 키에 `article_id + PROMPT_VERSION +
  content_hash`를 넣어 idempotent하게 재실행. 프롬프트를 수정하면 `*_PROMPT_VERSION`을 올려
  캐시를 무효화한다.

## 배칭 권장

- `03_enrich`는 **1건당 1콜** 권장(격리성·재개성·스키마 안정성). 비용을 더 줄여야 하면
  3~5건 마이크로배치 + `article_index` 매핑 배열 스키마로 전환 가능하나 기본은 1콜/기사.
- 동시성은 세마포어로 5~8콜 병렬 + 429 지수 백오프. 순서 의존성 없음.
