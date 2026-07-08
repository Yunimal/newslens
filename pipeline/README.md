# Python 데이터 파이프라인 (`pipeline/`)

이 폴더는 뉴스를 수집하고, 분석 정제 후 임베딩 추출, 차원 축소, 최종 스키마 검증 및 내보내기를 담당하는 Python 데이터 파이프라인 모듈로 구성되어 있습니다.

---

## 🚀 연쇄 자동 실행 가이드 (통합 러너)

6단계의 전체 파이프라인 단계를 일일이 따로 구동할 필요 없이, 아래 통합 실행 스크립트 단 **하나만** 구동하면 수집부터 정합성 검증 및 배포본 생성까지 연쇄적으로 자동 실행됩니다.

```bash
# 가상환경 구동 후 통합 실행
python pipeline/run_pipeline.py
```

---

## 🛠️ 실행 및 개발 가이드

파이프라인을 실행하기 전, Python 가상환경(`NLP_project` 등)에서 의존성을 먼저 설치해야 합니다.

```bash
# 가상환경 구동 후 패키지 설치
pip install -r pipeline/requirements.txt
```

### 1단계: 뉴스 데이터 수집 (`collect_sample.py`)
- RSS 소스로부터 기사 데이터를 크롤링하고 한글 형태소 필터링을 통해 1차 전처리 데이터를 생성합니다.
- **출력 파일**: `pipeline/raw/raw_articles_500.json`

### 2단계: LLM 뉴스 분석 및 정보 보강 (`enrich_articles.py`)
- **💡 중요 (API 키 연동 및 동적 오프라인 전환 로직)**:
  - **API 키가 없을 때 (오프라인 모드)**: `.env` 파일에 `OPENAI_API_KEY`가 없으면 LLM 호출 비용 방지 및 원활한 로컬 드라이런을 위해 API 호출을 안전하게 건너뛰며, 스키마 정합성을 만족하도록 모든 기사에 `entities: []`를 부여합니다.
  - **API 키 등록 시 (OpenAI API 연동)**: `.env`에 `OPENAI_API_KEY`가 감지되면 자동으로 OpenAI Chat Completion API(`gpt-4o-mini` 모델 및 structured json output 적용)를 호출하여 고품질의 3문장 요약(`summary3`), 주제 태그(`topic_tags`), 감성/논조(`sentiment`), 핵심 키워드(`keywords`) 및 엔티티(`entities: PER/ORG/LOC`)를 보강합니다.
- **출력 파일**: `pipeline/raw/raw_articles_500.json` (동적 보강 적용)

### 3단계: 고차원 임베딩 추출 (`generate_embeddings.py`)
- 기사의 제목과 본문을 통합하여 OpenAI 임베딩 벡터를 추출합니다.
- API 키가 없을 때는 결정론적 **Mock 임베딩 시스템**(`hash-fallback-v1`)이 자동 구동되어 512차원 벡터를 부여하고, API 키가 있으면 실제 **OpenAI Embedding API**(`text-embedding-3-small`)를 호출하여 시맨틱 벡터를 수집합니다.
- **출력 파일**: `pipeline/raw/embeddings_raw.json`

### 4단계: 2D 투영 차원 축소 (`reduce_dimensions.py`)
- 고차원 임베딩 벡터를 2차원 시각화 평면에 뿌릴 수 있도록 UMAP(Uniform Manifold Approximation and Projection) 알고리즘을 사용해 `(x, y)` 평면 좌표로 투영시킵니다.
- **출력 파일**: `pipeline/raw/articles_with_coords.json`

### 5단계: 통합 데이터 배포 및 Pydantic 검증 (`05_export.py`)
- 기존의 개별 기사 배포 스크립트와 임베딩 배포 스크립트를 통합한 최종 배포본 빌더입니다.
- **KMeans 알고리즘**을 돌려 6개의 이슈 군집(`cluster_id: 0~5`)을 자동 분류하고, 실제 개별 기사의 감성 정보를 집계하여 군집별 감성 분포(`sentiment_dist`) 정합성을 올바르게 계산합니다.
- **다단계 Pydantic 검증 게이트**:
  1. 기사 조립 루프 내에서 개별 `ArticleModel` 및 `EmbeddingItemModel`로 유효성을 검사하여 규격 미달인 기사 데이터를 안전하게 필터링(제외)합니다.
  2. 최종 덤프 전 `ArticlesFileModel` 및 `EmbeddingsFileModel`을 사용하여 데이터 전체의 완벽한 정합성을 보장한 후 배포합니다.
- **출력 파일**: `data/articles.json`, `data/embeddings.json`

### 6단계: 관계망 데이터 생성 및 클린업 (`create_graph.py`)
- 최종 `data/articles.json`을 읽어 빈도 상위 60개 엔티티 노드와 동시 출현 2회 이상(`weight >= 2`)의 엣지 관계망을 빌드합니다.
- 불필요한 중복을 방지하기 위해 엣지의 노드 연결 관계를 사전순 정렬(`source < target`)하여 저장하며, 레거시 레이아웃 데이터인 `data/coords.json`이 존재할 경우 자동으로 감지하여 청소(삭제)합니다.
- **출력 파일**: `data/graph.json`
