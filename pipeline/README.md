# Python 데이터 파이프라인 (`pipeline/`)

이 폴더는 뉴스를 수집하고, 임베딩 벡터를 추출 및 차원 축소하여 동결된 데이터 명세에 맞게 변환하는 Python 데이터 파이프라인 모듈로 구성되어 있습니다.

---

## 🚀 연쇄 자동 실행 가이드 (통합 러너)

5단계의 전체 파이프라인을 일일이 따로 구동할 필요 없이, 아래 통합 실행 스크립트 단 **하나만** 구동하면 수집부터 빌드까지 연쇄적으로 자동 실행됩니다.

```bash
# 가상환경 구동 후 통합 실행
python pipeline/run_pipeline.py
```

---

## 🛠️ 실행 및 개발 가이드

파이프라인을 실행하기 전, Python 가상환경(`NLP_project` 등)에서 의존성을 먼저 설치해야 합니다.

```bash
# 가상환경 구동 후 패키지 설치
pip install -r requirements.txt
```

### 1단계: 뉴스 데이터 수집 (`collect_sample.py`)
- 매체 소스로부터 기사 데이터를 크롤링하고 한글 형태소 필터링을 통해 1차 전처리 데이터를 생성합니다.
- **출력 파일**: `pipeline/raw/raw_articles_500.json`

### 2단계: 고차원 임베딩 추출 (`generate_embeddings.py`)
- 기사의 제목과 본문을 통합하여 OpenAI 임베딩 벡터를 추출합니다.
- **💡 중요 (API 키 연동 및 자동 전환 로직)**:
  - **API 키가 없을 때 (기본값)**: `.env` 파일에 `OPENAI_API_KEY`가 없으면 기사 텍스트 해시값을 활용해 동일한 기사에는 항상 일관된 벡터가 부여되도록 설계된 결정론적 **Mock 임베딩 시스템**(`hash-fallback-v1`)이 실행됩니다. API 호출 비용 없이 파이프라인 테스트를 진행할 수 있습니다.
  - **API 키 등록 시 (자동 전환)**: 루트의 `.env` 파일에 `OPENAI_API_KEY`를 입력하고 스크립트를 재실행하면, 코드 수정 없이 **자동으로 OpenAI Embedding API(`text-embedding-3-small`)를 직접 호출**하여 실제 고정밀 시맨틱 벡터를 수집합니다.
- **출력 파일**: `pipeline/raw/embeddings_raw.json` (1536차원 오리지널 벡터)

### 3단계: 2D 투영 차원 축소 (`reduce_dimensions.py`)
- 고차원(1536차원) 임베딩 벡터를 2차원 시각화 평면에 뿌릴 수 있도록 UMAP(Uniform Manifold Approximation and Projection) 알고리즘을 사용해 `(x, y)` 평면 좌표로 투영시킵니다.
- `umap-learn` 라이브러리가 없을 경우 PCA(주성분 분석) -> 파이썬 수학식 순으로 자동 폴백 설계가 적용되어 있습니다.
- **출력 파일**: `pipeline/raw/articles_with_coords.json`

### 4단계: 클라이언트 데이터 빌드 (`export_articles.json.py`)
- 차원 축소된 좌표를 바탕으로 **KMeans 알고리즘**을 돌려 6개의 이슈 군집(`cluster_id: 0~5`)을 자동 분류합니다.
- 동결 스키마 정합성을 검증하며 `published_at` 스네이크 케이스 롤백, 3문장 요약(`summary3`), 키워드 트렌드(**`trends[]` 시계열 집계 상위 20개**) 데이터를 최종 빌드합니다.
- 누적식 매핑 데이터베이스(`pipeline/raw/id_mappings.json`)를 통해, 데이터 추가 수집 시에도 기존에 매핑된 기사 ID(`a0001`~`aXXXX`)는 절대 변하지 않고 영구 보존됩니다.
- **출력 파일**: `data/articles.json`

### 5단계: 서버 전용 임베딩 파일 가공 (`export_embeddings.json.py`)
- 원본 `embeddings_raw.json`을 명세 규격에 맞춰 가공합니다.
- 백엔드 RAG 및 서버 인덱싱 전용으로 사용하기 위해 기사 ID를 `"aXXXX"` 형식으로 매핑하고, 1536차원 벡터를 **512차원으로 슬라이싱** 및 **소수점 4자리 반올림** 가공합니다.
- **출력 파일**: `data/embeddings.json` (⚠️ 서버 전용, 클라이언트 배포 금지)
