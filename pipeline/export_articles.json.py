import os
import sys
import json
import re
from datetime import datetime

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

INPUT_FILE = "pipeline/raw/articles_with_coords.json"
MAPPING_FILE = "pipeline/raw/id_mappings.json"
OUTPUT_DIR = "data"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "articles.json")

def clean_sentence(s):
    # 문장 끝에 마침표 보장
    s = s.strip()
    if s and not s.endswith('.'):
        s += '.'
    return s

def extract_top_words_for_cluster(cluster_articles, num_words=4):
    """군집 내 기사들의 제목에서 빈도가 가장 높은 대표 고유 단어들을 추출"""
    stop_words = {
        "연합뉴스", "연합뉴스tv", "기자", "종합", "속보", "명", "등", "및", "으로", 
        "에서", "에", "을", "를", "이", "가", "은", "는", "하고", "했다", "하며", "것으로", "했다 종합"
    }
    word_counts = {}
    
    for art in cluster_articles:
        title = art.get("title", "")
        # 특수문자 제거 후 띄어쓰기 기준으로 쪼갬
        words = re.sub(r'[^\w\s]', ' ', title).lower().split()
        for w in words:
            # 2글자 이상이고 불용어가 아닌 단어 카운트
            if len(w) >= 2 and w not in stop_words and not w.isdigit():
                word_counts[w] = word_counts.get(w, 0) + 1
                
    # 정렬하여 빈도가 높은 상위 단어 반환
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    return [w[0] for w in sorted_words[:num_words]]

def load_id_mappings():
    """ID 매핑 파일 로드"""
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[경고] ID 매핑 파일을 읽지 못했습니다: {e}")
    return {}

def save_id_mappings(mappings):
    """ID 매핑 파일 저장"""
    os.makedirs(os.path.dirname(MAPPING_FILE), exist_ok=True)
    try:
        with open(MAPPING_FILE, 'w', encoding='utf-8') as f:
            json.dump(mappings, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[에러] ID 매핑 파일을 저장하는 중 오류 발생: {e}")

def main():
    # 1. 대상 디렉토리 보장
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    if not os.path.exists(INPUT_FILE):
        print(f"Error: Input file '{INPUT_FILE}' does not exist. Please run UMAP script first.")
        sys.exit(1)

    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        raw_articles = json.load(f)

    if not raw_articles:
        print("Error: No articles loaded from input file.")
        sys.exit(1)

    print(f"Loaded {len(raw_articles)} articles. Preparing KMeans clustering...")

    # 2. KMeans 군집 분류 수행 (n_clusters = 6)
    coords = [[art["x"], art["y"]] for art in raw_articles]
    
    try:
        from sklearn.cluster import KMeans
        import numpy as np
        kmeans = KMeans(n_clusters=6, random_state=42, n_init=10)
        cluster_labels = kmeans.fit_predict(np.array(coords)).tolist()
    except Exception as e:
        print(f"[경고] scikit-learn 실행 중 에러 발생, 수동 군집화로 우회합니다. Error: {e}")
        cluster_labels = []
        for c in coords:
            x_idx = 0 if c[0] < 5.0 else (1 if c[0] < 7.0 else 2)
            y_idx = 0 if c[1] < 5.5 else 1
            cluster_labels.append(x_idx + y_idx * 3)

    # 각 기사에 cluster_id 매핑
    for art, c_id in zip(raw_articles, cluster_labels):
        art["cluster_id"] = c_id

    # 3. 누적식 ID 매핑 생성 및 갱신
    id_mappings = load_id_mappings()
    
    # 마지막으로 매핑된 순차 일련번호의 최댓값 탐색
    max_idx = 0
    for val in id_mappings.values():
        match = re.match(r"a(\d+)", val)
        if match:
            idx_num = int(match.group(1))
            if idx_num > max_idx:
                max_idx = idx_num

    # 결정론적 최초 부여를 위해 기사들을 원래 ID(AKR...) 기준으로 오름차순 정렬
    raw_articles = sorted(raw_articles, key=lambda x: x["id"])

    # ID 재매핑 적용
    for art in raw_articles:
        raw_id = art["id"]
        if raw_id not in id_mappings:
            max_idx += 1
            id_mappings[raw_id] = f"a{max_idx:04d}"
        
        # 기사의 실시간 id를 "aXXXX" 형식의 매핑된 ID로 교체
        art["mapped_id"] = id_mappings[raw_id]

    # 매핑 파일 영구 저장
    save_id_mappings(id_mappings)

    # 4. 군집별 통계 및 정보 연산
    clusters_data = []
    
    for c_id in range(6):
        # 현재 군집에 해당하는 기사만 필터링
        c_articles = [art for art in raw_articles if art["cluster_id"] == c_id]
        c_size = len(c_articles)
        
        if c_size > 0:
            avg_x = sum(art["x"] for art in c_articles) / c_size
            avg_y = sum(art["y"] for art in c_articles) / c_size
            
            top_words = extract_top_words_for_cluster(c_articles, 5)
            while len(top_words) < 3:
                top_words.append("이슈")
            
            label = f"{'·'.join(top_words[:2])} 관련 뉴스"
            if len(label) < 8:
                label = f"{'·'.join(top_words[:3])} 관련 보도"
                
            representative_title = c_articles[0]["title"]
            if len(c_articles) > 1:
                rep_title_2 = c_articles[1]["title"]
                summary_text = (
                    f"이 군집은 {', '.join(top_words[:3])} 등의 키워드를 주로 다루는 뉴스 모음입니다. "
                    f"대표적인 보도로는 '{representative_title}' 및 '{rep_title_2}' 등의 뉴스가 포함되어 있습니다."
                )
            else:
                summary_text = (
                    f"이 군집은 {', '.join(top_words[:2])} 관련 현안을 다루는 보도입니다. "
                    f"대표 기사로 '{representative_title}' 등이 보도되었습니다."
                )
                
            sentiment_dist = {"pos": 0, "neu": c_size, "neg": 0}
        else:
            avg_x, avg_y = 0.0, 0.0
            label = f"군집 {c_id}"
            summary_text = "이 군집에 해당하는 뉴스가 없습니다."
            top_words = ["뉴스", "보도", "이슈"]
            sentiment_dist = {"pos": 0, "neu": 0, "neg": 0}

        cluster_obj = {
            "id": c_id,
            "label": label,
            "summary": summary_text,
            "keywords": top_words[:5],
            "size": c_size,
            "centroid": {
                "x": round(avg_x, 4),
                "y": round(avg_y, 4)
            },
            "sentiment_dist": sentiment_dist
        }
        clusters_data.append(cluster_obj)

    # 5. 기사 정보 규격화 매핑 (Article schema 맞춤)
    mapped_articles = []
    dates = []
    
    for art in raw_articles:
        content = art.get("content", "")
        category = art.get("category", "일반")
        press = art.get("press", "연합뉴스")
        pub_date = art.get("published_at")
        
        if pub_date:
            dates.append(pub_date)

        # summary3 폴백 처리
        summary3_val = art.get("summary3")
        if not summary3_val:
            sentences = [clean_sentence(s) for s in re.split(r'[.!?]\s*', content) if s.strip()]
            if len(sentences) >= 3:
                summary3_val = [sentences[0], sentences[1], sentences[2]]
            elif len(sentences) == 2:
                summary3_val = [sentences[0], sentences[1], "세부적인 추가 요약 내용이 존재하지 않습니다."]
            elif len(sentences) == 1:
                summary3_val = [sentences[0], "추가 요약이 제공되지 않았습니다.", "세부적인 추가 요약 내용이 존재하지 않습니다."]
            else:
                summary3_val = ["본문 내용에 대한 요약 정보가 없습니다.", "추가 요약이 제공되지 않았습니다.", "세부적인 추가 요약 내용이 존재하지 않습니다."]

        # keywords 검증 및 폴백
        keywords_val = art.get("keywords")
        if not keywords_val:
            title = art.get("title", "")
            words = [w.strip() for w in re.split(r'\s+', title) if len(w.strip()) > 1]
            seen = set()
            unique_words = []
            for w in words + [category, press, "뉴스", "보도"]:
                w_clean = re.sub(r'[^\w]', '', w)
                if w_clean and w_clean not in seen:
                    seen.add(w_clean)
                    unique_words.append(w_clean)
                    if len(unique_words) == 5:
                        break
            while len(unique_words) < 3:
                unique_words.append("뉴스")
            keywords_val = unique_words[:5]

        item = {
            "id": art["mapped_id"], # 매핑된 "aXXXX" 형식 기사 ID 기입!
            "title": art.get("title", ""),
            "url": art.get("url", ""),
            "press": press,
            "published_at": pub_date,
            "category": category,
            "summary3": summary3_val,
            "topic_tags": art.get("topic_tags", [category]),
            "sentiment": art.get("sentiment", "neu"),
            "keywords": keywords_val,
            "entities": art.get("entities", []),
            "cluster_id": art.get("cluster_id"),
            "x": art.get("x"),
            "y": art.get("y")
        }
        mapped_articles.append(item)

    # 6. Meta 정보 조립
    collected_at_iso = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    date_from = min(dates) if dates else datetime.utcnow().strftime('%Y-%m-%d')
    date_to = max(dates) if dates else datetime.utcnow().strftime('%Y-%m-%d')

    meta_data = {
        "source_name": "연합뉴스",
        "collected_at": collected_at_iso,
        "date_from": date_from,
        "date_to": date_to,
        "article_count": len(mapped_articles),
        "cluster_count": 6
    }

    # 6.5. Trends 시계열 집계 (상위 20개 키워드 대상, 0인 날 포함)
    from datetime import timedelta
    from collections import Counter

    trends_data = []
    if dates and mapped_articles:
        start_dt = datetime.strptime(date_from, "%Y-%m-%d")
        end_dt = datetime.strptime(date_to, "%Y-%m-%d")
        delta = end_dt - start_dt
        all_dates = [(start_dt + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(delta.days + 1)]

        keyword_counter = Counter()
        for art in mapped_articles:
            for kw in art.get("keywords", []):
                keyword_counter[kw] += 1

        top_20_kws = [kw for kw, _ in keyword_counter.most_common(20)]

        for kw in top_20_kws:
            series_map = {dt: 0 for dt in all_dates}
            for art in mapped_articles:
                art_date = art.get("published_at")
                if art_date in series_map and kw in art.get("keywords", []):
                    series_map[art_date] += 1
            
            series_list = [{"date": dt, "count": series_map[dt]} for dt in all_dates]
            trends_data.append({
                "keyword": kw,
                "series": series_list
            })

    # 7. 최종 ArticlesFile 형식 객체화
    final_output = {
        "meta": meta_data,
        "clusters": clusters_data,
        "articles": mapped_articles,
        "trends": trends_data
    }

    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, indent=2)
        print(f"🚀 [성공] articles.json 파일이 '{OUTPUT_FILE}' 위치로 정상 처리되었습니다.")
    except Exception as e:
        print(f"Error: 파일 저장 중 에러가 발생했습니다: {e}")

if __name__ == "__main__":
    main()
