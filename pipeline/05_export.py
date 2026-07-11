import os
import sys
import json
import re
from datetime import datetime
from pydantic import ValidationError

# pydantic 검증 모델 임포트
try:
    from schemas import ArticleModel, ArticlesFileModel, EmbeddingItemModel, EmbeddingsFileModel
except ImportError:
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from schemas import ArticleModel, ArticlesFileModel, EmbeddingItemModel, EmbeddingsFileModel

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 공통 상수 정의
OUTPUT_DIR = "data"
MAPPING_FILE = "pipeline/raw/id_mappings.json"
ARTICLES_INPUT_FILE = "pipeline/raw/articles_with_coords.json"
ARTICLES_OUTPUT_FILE = os.path.join(OUTPUT_DIR, "articles.json")
EMBEDDINGS_INPUT_FILE = "pipeline/raw/embeddings_raw.json"
EMBEDDINGS_OUTPUT_FILE = os.path.join(OUTPUT_DIR, "embeddings.json")

def clean_sentence(s):
    s = s.strip()
    if s and not s.endswith('.'):
        s += '.'
    return s

def extract_top_words_for_cluster(cluster_articles, num_words=4):
    stop_words = {
        "연합뉴스", "연합뉴스tv", "기자", "종합", "속보", "명", "등", "및", "으로", 
        "에서", "에", "을", "를", "이", "가", "은", "는", "하고", "했다", "하며", "것으로", "했다 종합"
    }
    word_counts = {}
    for art in cluster_articles:
        title = art.get("title", "")
        words = re.sub(r'[^\w\s]', ' ', title).lower().split()
        for w in words:
            if len(w) >= 2 and w not in stop_words and not w.isdigit():
                word_counts[w] = word_counts.get(w, 0) + 1
                
    sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
    return [w[0] for w in sorted_words[:num_words]]

def load_id_mappings():
    if os.path.exists(MAPPING_FILE):
        try:
            with open(MAPPING_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[경고] ID 매핑 파일을 읽지 못했습니다: {e}")
    return {}

def save_id_mappings(mappings):
    os.makedirs(os.path.dirname(MAPPING_FILE), exist_ok=True)
    try:
        with open(MAPPING_FILE, 'w', encoding='utf-8') as f:
            json.dump(mappings, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[에러] ID 매핑 파일을 저장하는 중 오류 발생: {e}")

def export_articles():
    print("\n--------------------------------------------------")
    print("[NewsLens] Step A: articles.json 빌드 & Pydantic 검증")
    print("--------------------------------------------------")

    if not os.path.exists(ARTICLES_INPUT_FILE):
        print(f"Error: Input file '{ARTICLES_INPUT_FILE}' does not exist. Please run UMAP script first.")
        sys.exit(1)

    with open(ARTICLES_INPUT_FILE, 'r', encoding='utf-8') as f:
        raw_articles = json.load(f)

    if not raw_articles:
        print("Error: No articles loaded from input file.")
        sys.exit(1)

    print(f"Loaded {len(raw_articles)} articles. Using pre-computed high-dimensional cluster IDs...")
    for art in raw_articles:
        if "cluster_id" not in art:
            # 혹시 모를 누락 대비 폴백
            art["cluster_id"] = 0


    id_mappings = load_id_mappings()
    max_idx = 0
    for val in id_mappings.values():
        match = re.match(r"a(\d+)", val)
        if match:
            idx_num = int(match.group(1))
            if idx_num > max_idx:
                max_idx = idx_num

    raw_articles = sorted(raw_articles, key=lambda x: x["id"])

    for art in raw_articles:
        raw_id = art["id"]
        if raw_id not in id_mappings:
            max_idx += 1
            id_mappings[raw_id] = f"a{max_idx:04d}"
        art["mapped_id"] = id_mappings[raw_id]

    save_id_mappings(id_mappings)

    clusters_data = []
    for c_id in range(6):
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
                
            sentiment_dist = {
                "pos": sum(1 for art in c_articles if art.get("sentiment", "neu") == "pos"),
                "neu": sum(1 for art in c_articles if art.get("sentiment", "neu") == "neu"),
                "neg": sum(1 for art in c_articles if art.get("sentiment", "neu") == "neg")
            }
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

    mapped_articles = []
    dates = []
    
    for art in raw_articles:
        content = art.get("content", "")
        category = art.get("category", "일반")
        press = art.get("press", "연합뉴스")
        pub_date = art.get("published_at")
        
        if pub_date:
            dates.append(pub_date)

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
            "id": art["mapped_id"],
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
        
        # Pydantic을 활용한 1단계 기사 단위 검증 게이트
        try:
            item["summary3"] = tuple(item["summary3"])
            ArticleModel(**item)
            mapped_articles.append(item)
        except ValidationError as e:
            print(f"   [경고] 기사 '{item.get('id')}'가 스키마 검증에 실패하여 제외되었습니다. 오류: {e}")

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

    final_output = {
        "meta": meta_data,
        "clusters": clusters_data,
        "articles": mapped_articles,
        "trends": trends_data
    }

    # Pydantic을 활용한 2단계 최종 전체 파일 구조 검증 게이트
    print("   -> 배포 파일 최종 Pydantic 검증 중...")
    try:
        ArticlesFileModel(**final_output)
        print("   ✅ 최종 스키마 검증 통과 (ArticlesFile 정합성 확인 완료)")
    except ValidationError as e:
        print(f"❌ [에러] 최종 산출물이 frozen 스키마 규격을 충족하지 못합니다. 중단됩니다.\n오류 정보: {e}")
        sys.exit(1)

    try:
        with open(ARTICLES_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(final_output, f, ensure_ascii=False, indent=2)
        print(f"🚀 [성공] articles.json 파일이 '{ARTICLES_OUTPUT_FILE}' 위치로 정상 처리되었습니다.")
    except Exception as e:
        print(f"Error: 파일 저장 중 에러가 발생했습니다: {e}")

    return id_mappings

def export_embeddings(id_mappings):
    print("\n--------------------------------------------------")
    print("[NewsLens] Step B: embeddings.json 빌드 & Pydantic 검증")
    print("--------------------------------------------------")

    if not os.path.exists(EMBEDDINGS_INPUT_FILE):
        print(f"Error: Input file '{EMBEDDINGS_INPUT_FILE}' does not exist. Please run generate_embeddings script first.")
        sys.exit(1)

    with open(EMBEDDINGS_INPUT_FILE, 'r', encoding='utf-8') as f:
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
            sliced_v = [round(float(x), 4) for x in raw_v[:512]]
            
            # Pydantic 1단계: 임베딩 개별 아이템 유효성 검사
            try:
                elem = {"id": mapped_id, "v": sliced_v}
                EmbeddingItemModel(**elem)
                exported_items.append(elem)
            except ValidationError as e:
                print(f"   [경고] 임베딩 ID '{mapped_id}'가 스키마 검증에 실패하여 제외되었습니다. 오류: {e}")
        else:
            skipped_count += 1

    exported_items.sort(key=lambda x: x["id"])

    output_data = {
        "model": model_name,
        "dim": 512,
        "items": exported_items
    }

    # Pydantic 2단계: 최종 임베딩 파일 전체 유효성 검사
    print("   -> 배포 임베딩 최종 Pydantic 검증 중...")
    try:
        EmbeddingsFileModel(**output_data)
        print("   ✅ 최종 스키마 검증 통과 (EmbeddingsFile 정합성 확인 완료)")
    except ValidationError as e:
        print(f"❌ [에러] 최종 임베딩 산출물이 frozen 스키마 규격을 충족하지 못합니다. 중단됩니다.\n오류 정보: {e}")
        sys.exit(1)

    try:
        parts = []
        parts.append('{')
        parts.append(f'  "model": "{model_name}",')
        parts.append('  "dim": 512,')
        parts.append('  "items": [')
        
        item_strings = []
        for item in exported_items:
            v_str = json.dumps(item["v"])
            item_str = (
                f'    {{\n'
                f'      "id": "{item["id"]}",\n'
                f'      "v": {v_str}\n'
                f'    }}'
            )
            item_strings.append(item_str)
            
        parts.append(",\n".join(item_strings))
        parts.append('  ]')
        parts.append('}')
        
        json_content = "\n".join(parts)
        
        with open(EMBEDDINGS_OUTPUT_FILE, 'w', encoding='utf-8') as f:
            f.write(json_content)
            
        print(f"🚀 [성공] embeddings.json 파일이 '{EMBEDDINGS_OUTPUT_FILE}' 위치로 정상 처리되었습니다.")
        print(f"   - 총 매핑 성공 기사 수: {len(exported_items)}건")
        if skipped_count > 0:
            print(f"   - 매핑 테이블에 없어 제외된 기사 수: {skipped_count}건")
    except Exception as e:
        print(f"Error: 파일 저장 중 에러가 발생했습니다: {e}")

def main():
    print("==================================================")
    print("🌊 [NewsLens] 통합 데이터 배포 (Export) 단계 시작")
    print("==================================================")
    
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # 1. 기사 정보 익스포트 및 매핑 정보 획득
    id_mappings = export_articles()
    
    # 2. 매핑 정보 기반 임베딩 익스포트
    export_embeddings(id_mappings)
    
    print("\n==================================================")
    print("🎉 [성공] 통합 배포(05_export) 작업이 완료되었습니다!")
    print("==================================================")

if __name__ == "__main__":
    main()
