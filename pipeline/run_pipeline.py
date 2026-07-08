import os
import sys
import subprocess

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 순차적으로 실행할 파이프라인 스크립트 리스트
PIPELINE_STEPS = [
    "pipeline/collect_sample.py",       # 1단계: 뉴스 수집
    "pipeline/enrich_articles.py",       # 2단계: LLM 뉴스 분석 (요약/엔티티)
    "pipeline/generate_embeddings.py",   # 3단계: 임베딩 추출
    "pipeline/reduce_dimensions.py",    # 4단계: UMAP 차원 축소
    "pipeline/05_export.py",             # 5단계: 통합 데이터 배포 (articles/embeddings)
    "pipeline/create_graph.py"          # 6단계: 관계망 graph.json 빌드 및 클린업
]

def main():
    print("==================================================")
    print("🌊 [NewsLens] 통합 데이터 파이프라인 구동 시작")
    print("==================================================")
    
    # 가상환경의 python 실행 파일을 사용해 안정적으로 구동
    python_exe = sys.executable
    
    for idx, script in enumerate(PIPELINE_STEPS, 1):
        script_name = os.path.basename(script)
        print(f"\n👉 [{idx}/{len(PIPELINE_STEPS)}] 실행 중: {script_name}...")
        print("-" * 50)
        
        # 외부 프로세스로 스크립트 구동 (실시간 로그 출력을 위해 stdout/stderr 연결)
        result = subprocess.run([python_exe, script])
        
        if result.returncode != 0:
            print(f"\n❌ [오류 발생] {script_name} 실행 중 실패가 발생하여 파이프라인을 중단합니다. (Exit Code: {result.returncode})")
            sys.exit(result.returncode)
            
        print(f"✅ {script_name} 완료")
        print("-" * 50)
        
    print("\n==================================================")
    print("🎉 [성공] 전체 파이프라인 연쇄 실행이 완료되었습니다!")
    print("👉 'data/' 폴더에 모든 배포 파일이 갱신되었습니다.")
    print("==================================================")

if __name__ == "__main__":
    main()
