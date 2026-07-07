import os
import sys
import json

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

INPUT_FILE = "pipeline/raw/embeddings_raw.json"
MAPPING_FILE = "pipeline/raw/id_mappings.json"
OUTPUT_DIR = "data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "embeddings.json")

def main():
    # 1. 대상 디렉토리 보장
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(INPUT_FILE):
        print(f"Error: Input file '{INPUT_FILE}' does not exist. Please run generate_embeddings script first.")
        sys.exit(1)

    if not os.path.exists(MAPPING_FILE):
        print("[에러] ID 매핑 파일이 존재하지 않습니다. export_articles.json.py 스크립트를 먼저 실행해 주세요.")
        sys.exit(1)

    # ID 매핑 데이터 로드
    with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
        id_mappings = json.load(f)

    # 원본 임베딩 데이터 로드
    print(f"Loading raw embeddings from '{INPUT_FILE}'...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        raw_embeddings_data = json.load(f)

    raw_items = raw_embeddings_data.get("items", [])
    model_name = raw_embeddings_data.get("model", "text-embedding-3-small")

    print(f"Processing {len(raw_items)} items...")
    exported_items = []
    skipped_count = 0

    for item in raw_items:
        raw_id = item.get("id")
        if raw_id in id_mappings:
            mapped_id = id_mappings[raw_id]
            raw_v = item.get("v", [])
            # 512차원 제한 및 소수점 4자리 반올림
            sliced_v = [round(float(x), 4) for x in raw_v[:512]]
            
            exported_items.append({
                "id": mapped_id,
                "v": sliced_v
            })
        else:
            skipped_count += 1

    # 정렬하여 기사 ID 순으로 깔끔하게 저장 (예: a0001, a0002...)
    exported_items.sort(key=lambda x: x["id"])

    output_data = {
        "model": model_name,
        "dim": 512,
        "items": exported_items
    }

    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
            
        print(f"🚀 [성공] embeddings.json 파일이 '{OUTPUT_FILE}' 위치로 정상 처리되었습니다.")
        print(f"   - 총 매핑 성공 기사 수: {len(exported_items)}건")
        if skipped_count > 0:
            print(f"   - 매핑 테이블에 없어 제외된 기사 수: {skipped_count}건")
    except Exception as e:
        print(f"Error: 파일 저장 중 에러가 발생했습니다: {e}")

if __name__ == "__main__":
    main()
