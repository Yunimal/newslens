import os
import sys
import shutil

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

SRC_FILE = "pipeline/batch_requests.jsonl"
DEST_DIR = "pipeline/raw"
DEST_FILE = os.path.join(DEST_DIR, "batch_requests.jsonl")

def main():
    # 1. 대상 디렉토리 보장
    os.makedirs(DEST_DIR, exist_ok=True)

    # 2. 소스 파일 존재 여부 확인
    if not os.path.exists(SRC_FILE):
        if os.path.exists(DEST_FILE):
            print(f"[정보] batch_requests.jsonl 파일이 이미 '{DEST_FILE}' 위치로 안전하게 이동되어 존재합니다.")
        else:
            print(f"[정보] '{SRC_FILE}' 파일이 존재하지 않습니다. 이미 이동되었거나 아직 생성되지 않았을 수 있습니다.")
        return

    try:
        # 3. 파일 이동 처리 (덮어쓰기 허용)
        shutil.move(SRC_FILE, DEST_FILE)
        print(f"🚀 [성공] batch_requests.jsonl 파일이 '{DEST_FILE}' 위치로 정상 처리되었습니다.")
    except Exception as e:
        print(f"Error: 파일 이동 중 에러가 발생했습니다: {e}")

if __name__ == "__main__":
    main()
