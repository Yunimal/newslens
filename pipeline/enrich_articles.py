import os
import sys
import json
import time
import requests

# dotenv가 설치되어 있다면 환경 변수 로드
try:
    from dotenv import load_dotenv
    dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    load_dotenv(dotenv_path)
except ImportError:
    pass

# prompts 모듈 로드를 위한 sys.path 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
prompts_dir = os.path.join(current_dir, "prompts")
if prompts_dir not in sys.path:
    sys.path.append(prompts_dir)

try:
    from prompts import ENRICH_SYSTEM_PROMPT, ENRICH_USER_TEMPLATE, ENRICH_RESPONSE_FORMAT
except ImportError as e:
    print(f"[에러] 프롬프트 모듈을 불러오지 못했습니다: {e}")
    sys.exit(1)

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

INPUT_FILE = "pipeline/raw/raw_articles_500.json"
OUTPUT_FILE = "pipeline/raw/raw_articles_500.json"  # 인플레이스 덮어쓰기

def get_openai_enrichment(title, content, api_key):
    """OpenAI Chat Completion API 직접 호출 (gpt-4o-mini 및 structured output 적용)"""
    url = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    # 본문이 너무 길면 잘라서 전송 (토큰 절감 및 비용 가드)
    sliced_content = content[:4000]
    user_content = ENRICH_USER_TEMPLATE.format(title=title, body=sliced_content)
    
    payload = {
        "model": "gpt-4o-mini",
        "temperature": 0.2,
        "seed": 42,
        "max_tokens": 700,
        "response_format": ENRICH_RESPONSE_FORMAT,
        "messages": [
            {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
            {"role": "user", "content": user_content}
        ]
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            res_data = response.json()
            content_str = res_data["choices"][0]["message"]["content"]
            return json.loads(content_str)
        else:
            print(f"      [경고] OpenAI API 호출 실패 (Status Code: {response.status_code}): {response.text}")
    except Exception as e:
        print(f"      [경고] OpenAI API 요청 중 예외 발생: {e}")
        
    return None

def main():
    print("==================================================")
    print("[NewsLens] LLM 뉴스 분석 (Enrich) 단계 시작")
    print("==================================================")

    if not os.path.exists(INPUT_FILE):
        print(f"[에러] 입력 파일 '{INPUT_FILE}'이 존재하지 않습니다. 수집 단계를 먼저 확인해주세요.")
        sys.exit(1)

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        articles = json.load(f)

    print(f"Loaded {len(articles)} articles from '{INPUT_FILE}'.")

    # API 키 확인
    api_key = os.getenv("OPENAI_API_KEY")
    use_api = bool(api_key)
    
    if not use_api:
        print("[정보] OPENAI_API_KEY가 감지되지 않았습니다. 오프라인 모드로 빈 entities를 부여합니다.")
    else:
        print("[정보] OpenAI Chat API를 사용해 기사 분석 및 엔티티 추출을 진행합니다. (모델: gpt-4o-mini)")

    enriched_count = 0
    fallback_count = 0

    for idx, art in enumerate(articles, 1):
        art_id = art.get("id")
        title = art.get("title", "")
        content = art.get("content", "")
        
        enrich_data = None
        if use_api:
            # 1초당 API 호출 한도 가드를 위한 미세 딜레이
            time.sleep(0.1)
            print(f"   -> [{idx}/{len(articles)}] 기사 분석 중... (ID: {art_id})")
            enrich_data = get_openai_enrichment(title, content, api_key)
            
        if enrich_data is not None:
            # API 성공 시: 리턴된 고품질 메타데이터 매핑
            art["summary3"] = enrich_data.get("summary3")
            art["topic_tags"] = enrich_data.get("topic_tags")
            art["sentiment"] = enrich_data.get("sentiment")
            art["keywords"] = enrich_data.get("keywords")
            art["entities"] = enrich_data.get("entities", [])
            enriched_count += 1
        else:
            # API가 없거나 에러가 발생한 경우: entities는 스키마 규격에 맞춰 빈 배열 []로 고정
            art["entities"] = []
            # summary3, keywords, sentiment 등은 export_articles.json.py가 로컬 폴백을 가지고 있으므로 None으로 둠
            fallback_count += 1

        if not use_api and idx % 100 == 0:
            print(f"   -> 오프라인 처리 진행 상황: {idx}/{len(articles)} 기사 처리 완료...")

    # 결과 저장 (raw_articles_500.json 파일에 그대로 덮어씀)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(articles, f, ensure_ascii=False, indent=2)

    print("\n=== LLM 뉴스 분석(Enrich) 완료 ===")
    print(f"결과 파일: '{OUTPUT_FILE}'")
    print(f"LLM API 분석 성공: {enriched_count}건")
    print(f"오프라인 폴백 처리: {fallback_count}건")
    print("==================================================")

if __name__ == "__main__":
    main()
