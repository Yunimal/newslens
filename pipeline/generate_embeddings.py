import os
import sys
import json
import hashlib
import random
import requests

# dotenv가 설치되어 있다면 환경 변수 로드
try:
    from dotenv import load_dotenv
    # 프로젝트 루트의 .env 파일 위치 지정
    dotenv_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env"))
    load_dotenv(dotenv_path)
except ImportError:
    pass

INPUT_FILE = "pipeline/raw/raw_articles_500.json"
OUTPUT_FILE = "pipeline/raw/embeddings_raw.json"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536

def generate_mock_vector(text, dim=EMBEDDING_DIM):
    """API 키가 없을 때를 대비한 결정론적(deterministic) 모형 임베딩 벡터 생성"""
    # 텍스트 해시값을 시드로 사용하여 난수 생성기 초기화 (항상 동일한 텍스트에 동일한 벡터 반환)
    seed = int(hashlib.sha256(text.encode('utf-8')).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)
    # 임베딩 벡터 범위는 보통 -1.0 ~ 1.0 사이
    vec = [round(rng.uniform(-0.5, 0.5), 6) for _ in range(dim)]
    # L2 정규화 (유클리드 거리 및 코사인 유사도 연산을 위해 크기를 1로 맞춤)
    norm = sum(x**2 for x in vec)**0.5
    if norm > 0:
        vec = [round(x / norm, 6) for x in vec]
    return vec

def get_openai_embedding(text, api_key):
    """requests 모듈을 사용해 OpenAI Embedding API 직접 호출 (의존성 최소화)"""
    url = "https://api.openai.com/v1/embeddings"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "input": text,
        "model": EMBEDDING_MODEL
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code == 200:
            res_data = response.json()
            return res_data["data"][0]["embedding"]
        else:
            print(f"      [경고] OpenAI API 호출 실패 (Status Code: {response.status_code}): {response.text}")
    except Exception as e:
        print(f"      [경고] OpenAI API 요청 중 예외 발생: {e}")
    
    return None

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: Input file '{INPUT_FILE}' does not exist. Please run crawler first.")
        sys.exit(1)

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        articles = json.load(f)

    print(f"Loaded {len(articles)} articles from '{INPUT_FILE}'.")

    # API 키 확인
    api_key = os.getenv("OPENAI_API_KEY")
    use_mock = False
    
    if not api_key:
        print("[정보] OPENAI_API_KEY가 설정되지 않았습니다. 결정론적 Mock 임베딩 벡터를 생성합니다.")
        use_mock = True
    else:
        print(f"[정보] OpenAI Embedding API를 활용하여 임베딩을 추출합니다. (모델: {EMBEDDING_MODEL})")

    embedding_items = []
    success_count = 0
    mock_count = 0

    for idx, art in enumerate(articles, 1):
        art_id = art.get("id")
        title = art.get("title", "")
        content = art.get("content", "")
        
        # 임베딩할 대상 텍스트 조립
        text_to_embed = f"제목: {title}\n본문: {content}"
        
        vector = None
        if not use_mock:
            # 1초당 호출 제한 방지를 위한 짧은 슬립
            import time
            time.sleep(0.1)
            vector = get_openai_embedding(text_to_embed, api_key)
            
        if vector is not None:
            success_count += 1
        else:
            # API 키가 없거나 호출이 실패한 경우 Mock 벡터 생성
            vector = generate_mock_vector(text_to_embed)
            mock_count += 1
            
        embedding_items.append({
            "id": art_id,
            "v": vector
        })

        if idx % 50 == 0 or idx == len(articles):
            print(f"   -> 진행 상황: {idx}/{len(articles)} 기사 처리 완료...")

    # 최종 결과 저장
    output_data = {
        "model": "hash-fallback-v1" if use_mock or mock_count == len(articles) else EMBEDDING_MODEL,
        "dim": EMBEDDING_DIM,
        "items": embedding_items
    }

    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)

    print("\n=== 임베딩 생성 완료 ===")
    print(f"결과 파일: '{OUTPUT_FILE}'")
    print(f"실제 OpenAI API 임베딩 수집: {success_count}건")
    print(f"Mock 임베딩 생성: {mock_count}건")
    print(f"총 임베딩 개수: {len(embedding_items)}건 (차원 수: {EMBEDDING_DIM})")

if __name__ == "__main__":
    main()
