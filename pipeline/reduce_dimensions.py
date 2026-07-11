import os
import sys
import json
import random
import hashlib

INPUT_ARTICLES = "pipeline/raw/raw_articles_500.json"
INPUT_EMBEDDINGS = "pipeline/raw/embeddings_raw.json"
OUTPUT_ARTICLES = "pipeline/raw/articles_with_coords.json"

def random_projection_2d(vectors, seed=42):
    """
    UMAP이나 scikit-learn이 없을 때를 위한 고차원 벡터 -> 2차원 결정론적 무작위 투영 (Gram-Schmidt 정형화 적용)
    """
    if not vectors:
        return []
    
    dim = len(vectors[0])
    rng = random.Random(seed)
    
    # 1. 2개의 무작위 가우시안 기저 벡터 생성
    v1 = [rng.gauss(0, 1) for _ in range(dim)]
    v2 = [rng.gauss(0, 1) for _ in range(dim)]
    
    # 2. Gram-Schmidt 과정을 통한 직교화 (v2를 v1에 직교하도록 변환)
    dot_12 = sum(x*y for x, y in zip(v1, v2))
    dot_11 = sum(x*x for x in v1)
    
    # 직교 벡터 계산
    v2 = [y - (dot_12 / dot_11) * x for x, y in zip(v1, v2)]
    
    # 3. 크기가 1이 되도록 정규화
    len_v1 = sum(x*x for x in v1) ** 0.5
    len_v2 = sum(y*y for y in v2) ** 0.5
    
    v1 = [x / len_v1 for x in v1]
    v2 = [y / len_v2 for y in v2]
    
    # 4. 각 벡터를 평면에 투영하여 2D 좌표 연산 (시각화 표현력 증대를 위해 Scale 15.0 적용)
    coords = []
    for vec in vectors:
        x = sum(a*b for a, b in zip(vec, v1)) * 15.0
        y = sum(a*b for a, b in zip(vec, v2)) * 15.0
        coords.append((round(x, 4), round(y, 4)))
        
    return coords

def main():
    if not os.path.exists(INPUT_ARTICLES):
        print(f"Error: Articles file '{INPUT_ARTICLES}' does not exist.")
        sys.exit(1)
    if not os.path.exists(INPUT_EMBEDDINGS):
        print(f"Error: Embeddings file '{INPUT_EMBEDDINGS}' does not exist.")
        sys.exit(1)

    # 데이터 로드
    with open(INPUT_ARTICLES, 'r', encoding='utf-8') as f:
        articles = json.load(f)
    with open(INPUT_EMBEDDINGS, 'r', encoding='utf-8') as f:
        embeddings_data = json.load(f)

    print(f"Loaded {len(articles)} articles and {len(embeddings_data['items'])} embeddings.")

    # 매핑 테이블 구축 (id -> vector)
    id_to_vector = {item["id"]: item["v"] for item in embeddings_data["items"]}
    
    # 정렬된 순서로 벡터 추출 및 유효 기사 식별
    valid_articles = []
    vectors = []
    
    for art in articles:
        art_id = art.get("id")
        if art_id in id_to_vector:
            valid_articles.append(art)
            vectors.append(id_to_vector[art_id])
        else:
            print(f"   [경고] 기사 ID '{art_id}'에 매칭되는 임베딩 벡터가 존재하지 않아 제외합니다.")

    if not vectors:
        print("Error: No matching embeddings found.")
        sys.exit(1)

    print(f"Processing dimension reduction for {len(vectors)} matching articles...")

    coords = None
    method_used = "Mathematical Random Projection"

    # 1단계 시도: UMAP
    try:
        import umap
        import numpy as np
        print("[정보] umap-learn 라이브러리를 사용하여 차원 축소를 시작합니다...")
        reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
        coords_np = reducer.fit_transform(np.array(vectors))
        coords = [(round(float(c[0]), 4), round(float(c[1]), 4)) for c in coords_np]
        method_used = "UMAP"
    except ImportError:
        # 2단계 시도: Scikit-learn t-SNE / PCA
        try:
            from sklearn.decomposition import PCA
            import numpy as np
            print("[정보] umap-learn을 찾을 수 없어 scikit-learn PCA를 대신 사용합니다...")
            pca = PCA(n_components=2, random_state=42)
            coords_np = pca.fit_transform(np.array(vectors))
            coords = [(round(float(c[0]), 4), round(float(c[1]), 4)) for c in coords_np]
            method_used = "scikit-learn PCA"
        except ImportError:
            # 3단계: 순수 파이썬 수학식 폴백
            print("[정보] 외부 차원축소 라이브러리가 없어 무작위 투영(Mathematical Random Projection) 폴백을 적용합니다.")
            coords = random_projection_2d(vectors)
            method_used = "Mathematical Random Projection (Fallback)"

    # 512차원 고차원 벡터 기준 KMeans 군집화 수행
    cluster_labels = []
    try:
        from sklearn.cluster import KMeans
        import numpy as np
        print("[정보] 512차원 고차원 임베딩 기준 KMeans 군집화를 실행합니다...")
        kmeans = KMeans(n_clusters=6, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(np.array(vectors)).tolist()
    except Exception as e:
        print(f"[경고] 고차원 군집화 중 에러가 발생하여 단순 라운드로빈(i % 6)으로 우회합니다. Error: {e}")
        cluster_labels = [i % 6 for i in range(len(vectors))]

    # X, Y 좌표 및 cluster_id를 기사 데이터 객체에 병합
    output_articles = []
    for art, (x, y), c_id in zip(valid_articles, coords, cluster_labels):
        # 원본 복사
        art_copy = dict(art)
        art_copy["x"] = x
        art_copy["y"] = y
        art_copy["cluster_id"] = c_id
        output_articles.append(art_copy)

    # 파일 저장
    with open(OUTPUT_ARTICLES, 'w', encoding='utf-8') as f:
        json.dump(output_articles, f, ensure_ascii=False, indent=2)

    print(f"\n=== 차원 축소 및 군집화 완료 ===")
    print(f"적용된 알고리즘: {method_used} + High-Dim KMeans")
    print(f"최종 결과 저장: '{OUTPUT_ARTICLES}' (총 {len(output_articles)}건)")

if __name__ == "__main__":
    main()

