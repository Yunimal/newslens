"""
pipeline/prompts/test_prompts.py — enrich/cluster 프롬프트 자기검증 (B Day 1: "샘플 5건 프롬프트 테스트 통과")

두 가지 모드:
  1) 오프라인(기본): OpenAI strict json_schema 불변식을 정적 검증한다. 키 없이 지금 실행 가능.
       python3 pipeline/prompts/test_prompts.py
  2) 실행(키 있을 때): 샘플 5건에 enrich 프롬프트를 실제로 돌려 출력이 frozen 스키마를 만족하는지 확인.
       pip install openai
       OPENAI_API_KEY=... python3 pipeline/prompts/test_prompts.py

종료코드 0 = 통과, 1 = 실패. A가 파이프라인 붙이기 전 프롬프트/스키마 검증용으로도 사용.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from prompts import (  # noqa: E402
    ENRICH_RESPONSE_FORMAT,
    ENRICH_SYSTEM_PROMPT,
    ENRICH_USER_TEMPLATE,
    CLUSTER_RESPONSE_FORMAT,
)

SENTIMENTS = {"pos", "neu", "neg"}
ENTITY_TYPES = {"PER", "ORG", "LOC"}


# ── 1) 오프라인: OpenAI strict json_schema 불변식 검증 ──────────────────────────
def check_strict_schema(rf: dict, name: str) -> list[str]:
    """strict 모드 필수 조건: 모든 object는 additionalProperties:false, 모든 property가 required."""
    errs: list[str] = []
    js = rf.get("json_schema", {})
    if js.get("strict") is not True:
        errs.append(f"{name}: strict가 true가 아님")

    def walk(schema: dict, path: str) -> None:
        if schema.get("type") == "object":
            if schema.get("additionalProperties") is not False:
                errs.append(f"{name}{path}: additionalProperties:false 아님")
            props = set(schema.get("properties", {}).keys())
            req = set(schema.get("required", []))
            if props != req:
                errs.append(f"{name}{path}: required != properties (누락 {props - req})")
            for k, v in schema.get("properties", {}).items():
                walk(v, f"{path}.{k}")
        elif schema.get("type") == "array":
            walk(schema.get("items", {}), f"{path}[]")

    walk(js.get("schema", {}), "")
    return errs


def test_schemas() -> bool:
    print("[1] strict json_schema 정적 검증")
    errs = check_strict_schema(ENRICH_RESPONSE_FORMAT, "enrich")
    errs += check_strict_schema(CLUSTER_RESPONSE_FORMAT, "cluster")
    # enum 존재 확인
    enrich_props = ENRICH_RESPONSE_FORMAT["json_schema"]["schema"]["properties"]
    if set(enrich_props["sentiment"]["enum"]) != SENTIMENTS:
        errs.append("enrich.sentiment enum != {pos,neu,neg}")
    ent_type = enrich_props["entities"]["items"]["properties"]["type"]
    if set(ent_type["enum"]) != ENTITY_TYPES:
        errs.append("enrich.entities.type enum != {PER,ORG,LOC}")
    for e in errs:
        print("   ✗", e)
    if not errs:
        print("   ✓ enrich/cluster 스키마가 strict 불변식·enum을 만족")
    return not errs


# ── 2) frozen 스키마 기준 출력 검증 ────────────────────────────────────────────
def validate_enrich_output(d: dict) -> list[str]:
    errs = []
    if not (isinstance(d.get("summary3"), list) and len(d["summary3"]) == 3):
        errs.append("summary3 != 3문장")
    if not (1 <= len(d.get("topic_tags", [])) <= 3):
        errs.append("topic_tags 개수 1~3 아님")
    if d.get("sentiment") not in SENTIMENTS:
        errs.append(f"sentiment 잘못됨: {d.get('sentiment')}")
    if not (3 <= len(d.get("keywords", [])) <= 5):
        errs.append("keywords 개수 3~5 아님")
    for ent in d.get("entities", []):
        if ent.get("type") not in ENTITY_TYPES:
            errs.append(f"entity type 잘못됨: {ent}")
    return errs


SAMPLES = [
    ("한국은행 기준금리 3.5% 동결", "한국은행 금융통화위원회는 오늘 기준금리를 연 3.5%로 동결했다. 이창용 총재는 물가 둔화세를 근거로 들며 당분간 관망하겠다고 밝혔다."),
    ("삼성전자, 차세대 AI 반도체 공개", "삼성전자가 전력 효율을 크게 높인 신형 AI 가속기를 공개했다. 회사는 하반기 양산에 들어갈 계획이라고 밝혔다."),
    ("전국 폭염 특보…온열질환 주의", "기상청이 전국 대부분 지역에 폭염 특보를 발효했다. 낮 최고기온이 35도까지 오를 것으로 예보돼 온열질환 주의가 당부됐다."),
    ("국회, 추경 예산안 협상 난항", "여야가 추경 예산안 규모를 두고 이견을 좁히지 못했다. 처리 시한이 임박해 진통이 예상된다."),
    ("축구 대표팀, 월드컵 예선 2-0 승", "축구 국가대표팀이 월드컵 예선에서 상대를 2-0으로 꺾었다. 이로써 조 1위 자리를 지켰다."),
]


def test_live() -> bool:
    print("[2] 샘플 5건 enrich 실행 검증 (실 gpt-4o-mini)")
    from openai import OpenAI  # noqa: PLC0415

    client = OpenAI()
    ok = True
    for i, (title, body) in enumerate(SAMPLES, 1):
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            seed=42,
            max_tokens=700,
            response_format=ENRICH_RESPONSE_FORMAT,
            messages=[
                {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
                {"role": "user", "content": ENRICH_USER_TEMPLATE.format(title=title, body=body)},
            ],
        )
        data = json.loads(resp.choices[0].message.content)
        errs = validate_enrich_output(data)
        mark = "✓" if not errs else "✗"
        print(f"   {mark} [{i}] {title}  → sentiment={data.get('sentiment')}, "
              f"tags={data.get('topic_tags')}, entities={len(data.get('entities', []))}")
        for e in errs:
            print("       -", e)
        ok = ok and not errs
    return ok


if __name__ == "__main__":
    passed = test_schemas()
    if os.getenv("OPENAI_API_KEY"):
        passed = test_live() and passed
    else:
        print("[2] OPENAI_API_KEY 없음 → 실 실행 스킵. "
              "키를 넣고 다시 실행하면 샘플 5건을 실제로 검증합니다.")
    print("\n결과:", "PASS ✅" if passed else "FAIL ❌")
    sys.exit(0 if passed else 1)
