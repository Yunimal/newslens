import os
import sys
import json
import re

# sys.path에 프로젝트 루트 디렉토리 추가
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from pipeline.prompts.prompts import (
    ENRICH_SYSTEM_PROMPT,
    ENRICH_USER_TEMPLATE,
    ENRICH_RESPONSE_FORMAT,
)

CACHE_DIR = "pipeline/cache"
OUTPUT_FILE = "pipeline/batch_requests.jsonl"

def main():
    if not os.path.exists(CACHE_DIR):
        print(f"Error: Cache directory '{CACHE_DIR}' does not exist.")
        return

    # cache 디렉토리 내의 모든 .json 파일 찾기
    files = [f for f in os.listdir(CACHE_DIR) if f.endswith(".json")]
    print(f"Found {len(files)} cache files in '{CACHE_DIR}'.")

    requests_count = 0
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_f:
        for fname in files:
            filepath = os.path.join(CACHE_DIR, fname)
            try:
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # 1. 고유 ID 추출 (JSON 필드 우선, 없으면 파일명에서 추출)
                article_id = data.get("id")
                if not article_id:
                    # 파일명 형식: article_{ID}.json
                    match = re.match(r"article_(.+)\.json", fname)
                    if match:
                        article_id = match.group(1)
                    else:
                        article_id = fname.replace(".json", "")

                title = data.get("title", "")
                content = data.get("content", "")

                # 2. 본문 Truncation (최대 4,000자)
                body_truncated = content[:4000]

                # 3. OpenAI Batch Request 개체 조립
                request_obj = {
                    "custom_id": f"article_{article_id}",
                    "method": "POST",
                    "url": "/v1/chat/completions",
                    "body": {
                        "model": "gpt-4o-mini",
                        "messages": [
                            {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
                            {"role": "user", "content": ENRICH_USER_TEMPLATE.format(title=title, body=body_truncated)}
                        ],
                        "response_format": ENRICH_RESPONSE_FORMAT,
                        "temperature": 0.2,
                        "seed": 42,
                        "max_tokens": 700
                    }
                }

                # 4. JSONL 한 줄로 직렬화하여 작성
                line = json.dumps(request_obj, ensure_ascii=False)
                out_f.write(line + "\n")
                requests_count += 1

            except Exception as e:
                print(f"Error processing file '{fname}': {e}")

    print(f"Successfully generated '{OUTPUT_FILE}' with {requests_count} request lines.")

if __name__ == "__main__":
    main()
