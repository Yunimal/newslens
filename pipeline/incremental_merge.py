"""
[증분 수집 2/2] 기존 data/articles.json(+embeddings.json) 위에 신규 수집분을 누적 병합한다.

정책(요청 조건 그대로):
- 기존 기사: id·url·enrich(요약/논조/엔티티/키워드)·임베딩을 그대로 보존. GPT 재호출 없음.
- 신규 기사: URL로 중복 판정(기존에 있으면 버림), 새 id는 기존 최대 번호 다음부터 순차 부여.
- 병합본 전체 기준으로 x,y(UMAP)·cluster_id(KMeans)·clusters·meta·trends·sentiment_dist 재집계.
- 신규 임베딩 모델이 기존과 다르면(예: hash-fallback-v1) 벡터공간 불일치이므로 중단(키 누락 방어).
- 최종 산출물은 pydantic 검증 + placeholder/보일러플레이트 검사를 통과해야만 파일에 반영.
  (이 스크립트는 검증 실패 시 예외로 중단할 뿐, 파일을 건드리지 않는다 → 호출측이 backup 롤백)

입력:  data/articles.json, data/embeddings.json (기존)
       pipeline/raw/raw_articles_500.json (신규·enrich 완료), pipeline/raw/embeddings_raw.json (신규)
출력:  data/articles.json, data/embeddings.json (병합본). graph.json은 이후 create_graph.py가 생성.
"""
import os
import re
import sys
import json
from datetime import datetime, timedelta
from collections import Counter

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

OLD_ARTICLES = "data/articles.json"
OLD_EMB = "data/embeddings.json"
NEW_ARTICLES = "pipeline/raw/raw_articles_500.json"
NEW_EMB = "pipeline/raw/embeddings_raw.json"
EMBED_DIM = 512

PLACEHOLDER_PHRASES = [
    "추가 요약이 제공되지 않",
    "세부적인 추가 요약 내용이 존재하지 않",
    "요약 정보가 없",
    "제공되지 않았습니다",
    "존재하지 않습니다",
]
BOILERPLATE_PHRASES = ["마이뉴스", "맞춤 추천 뉴스"]

STOP_WORDS = {
    "연합뉴스", "연합뉴스tv", "기자", "종합", "속보", "명", "등", "및", "으로",
    "에서", "에", "을", "를", "이", "가", "은", "는", "하고", "했다", "하며", "것으로", "했다 종합",
}


def norm_url(u: str) -> str:
    if not u:
        return ""
    u = u.split("?")[0].strip()
    return u[:-1] if u.endswith("/") else u


def has_bad_text(s: str) -> bool:
    return any(p in s for p in PLACEHOLDER_PHRASES) or any(p in s for p in BOILERPLATE_PHRASES)


def valid_new_record(art):
    """신규 기사 enrich 결과 품질/스키마 검사. 통과하면 정제된 필드 dict, 실패하면 None."""
    s3 = art.get("summary3")
    if not isinstance(s3, list) or len(s3) != 3:
        return None
    s3 = [str(x).strip() for x in s3]
    if any(not x for x in s3) or any(has_bad_text(x) for x in s3):
        return None

    sentiment = art.get("sentiment")
    if sentiment not in ("pos", "neu", "neg"):
        return None

    keywords = [str(k).strip() for k in (art.get("keywords") or []) if str(k).strip()]
    keywords = keywords[:5]
    if len(keywords) < 3:
        return None

    topic_tags = [str(t).strip() for t in (art.get("topic_tags") or []) if str(t).strip()]
    topic_tags = topic_tags[:3]
    if len(topic_tags) < 1:
        topic_tags = [art.get("category", "일반")]

    entities = []
    for e in art.get("entities", []) or []:
        name = str(e.get("name", "")).strip()
        etype = str(e.get("type", "")).strip().upper()
        if name and etype in ("PER", "ORG", "LOC"):
            entities.append({"name": name, "type": etype})

    pub = art.get("published_at") or ""
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", pub):
        return None

    return {
        "title": art.get("title", ""),
        "url": art.get("url", ""),
        "press": art.get("press", "연합뉴스"),
        "published_at": pub,
        "category": art.get("category", "일반"),
        "summary3": s3,
        "topic_tags": topic_tags,
        "sentiment": sentiment,
        "keywords": keywords,
        "entities": entities,
    }


def extract_top_words(cluster_articles, num=5):
    counts = {}
    for art in cluster_articles:
        for w in re.sub(r"[^\w\s]", " ", art.get("title", "")).lower().split():
            if len(w) >= 2 and w not in STOP_WORDS and not w.isdigit():
                counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda x: (-x[1], x[0]))[:num]]


def main():
    for f in (OLD_ARTICLES, OLD_EMB, NEW_ARTICLES, NEW_EMB):
        if not os.path.exists(f):
            print(f"[에러] 필수 입력 '{f}'가 없습니다.")
            sys.exit(1)

    old = json.load(open(OLD_ARTICLES, encoding="utf-8"))
    old_emb = json.load(open(OLD_EMB, encoding="utf-8"))
    new_arts = json.load(open(NEW_ARTICLES, encoding="utf-8"))
    new_emb = json.load(open(NEW_EMB, encoding="utf-8"))

    old_articles = old["articles"]
    old_model = old_emb.get("model")
    new_model = new_emb.get("model")

    # 안전장치: 신규 임베딩이 실 임베딩이 아니면(키 누락 시 hash-fallback-v1) 벡터공간 불일치 → 중단
    if new_model != old_model:
        print(f"[중단] 임베딩 모델 불일치: 기존='{old_model}' vs 신규='{new_model}'.")
        print("       OPENAI_API_KEY 없이 신규 임베딩이 hash-fallback으로 생성됐을 가능성이 큽니다.")
        print("       키를 설정하고 generate_embeddings.py를 다시 실행하세요. (병합 미수행)")
        sys.exit(1)

    new_emb_by_id = {it["id"]: it["v"] for it in new_emb["items"]}
    old_urls = {norm_url(a["url"]) for a in old_articles}
    max_num = max((int(a["id"][1:]) for a in old_articles), default=0)

    # ---- 신규 레코드 조립 (id 부여·512 슬라이스·품질 검사) ----
    new_records, new_emb_items = [], []
    skipped_dup = skipped_quality = skipped_noemb = 0
    next_num = max_num
    for art in sorted(new_arts, key=lambda a: (a.get("published_at", ""), a.get("url", ""))):
        u = norm_url(art.get("url", ""))
        if not u or u in old_urls:
            skipped_dup += 1
            continue
        slug = art.get("id")
        if slug not in new_emb_by_id:
            skipped_noemb += 1
            continue
        rec = valid_new_record(art)
        if rec is None:
            skipped_quality += 1
            continue
        old_urls.add(u)
        next_num += 1
        aid = f"a{next_num:04d}"
        v = [round(float(x), 4) for x in new_emb_by_id[slug][:EMBED_DIM]]
        if len(v) != EMBED_DIM:
            skipped_noemb += 1
            continue
        rec["id"] = aid
        new_records.append(rec)
        new_emb_items.append({"id": aid, "v": v})

    print(f"신규 채택 {len(new_records)}건 | 중복 {skipped_dup} · 품질탈락 {skipped_quality} · 임베딩없음 {skipped_noemb}")

    # ---- 병합본 구성 (기존은 enrich/embedding 보존, x/y/cluster_id는 곧 재계산) ----
    combined = [dict(a) for a in old_articles] + [dict(r) for r in new_records]
    emb_by_id = {it["id"]: it["v"] for it in old_emb["items"]}
    for it in new_emb_items:
        emb_by_id[it["id"]] = it["v"]

    # 기사 순서에 맞춰 벡터 정렬 (임베딩 없는 기존 기사는 오류)
    ids = [a["id"] for a in combined]
    missing = [i for i in ids if i not in emb_by_id]
    if missing:
        print(f"[중단] 임베딩이 없는 기사 {len(missing)}건: {missing[:5]}")
        sys.exit(1)
    vectors = [emb_by_id[i] for i in ids]

    # ---- 전체 재계산: UMAP(x,y) + KMeans(cluster_id) ----
    import numpy as np
    from sklearn.cluster import KMeans
    X = np.array(vectors, dtype=float)
    print(f"UMAP/KMeans 재계산 대상: {len(combined)}건 x {X.shape[1]}차원")
    try:
        import umap
        reducer = umap.UMAP(n_components=2, random_state=42, n_neighbors=15, min_dist=0.1)
        coords = reducer.fit_transform(X)
    except ImportError:
        from sklearn.decomposition import PCA
        print("[정보] umap-learn 없음 → PCA 폴백")
        coords = PCA(n_components=2, random_state=42).fit_transform(X)
    labels = KMeans(n_clusters=6, random_state=42, n_init=10).fit_predict(X).tolist()
    for art, (x, y), c in zip(combined, coords, labels):
        art["x"] = round(float(x), 4)
        art["y"] = round(float(y), 4)
        art["cluster_id"] = int(c)

    # ---- clusters[] 재구성 ----
    clusters = []
    for cid in range(6):
        members = [a for a in combined if a["cluster_id"] == cid]
        size = len(members)
        if size:
            avg_x = sum(a["x"] for a in members) / size
            avg_y = sum(a["y"] for a in members) / size
            top = extract_top_words(members, 5)
            while len(top) < 3:
                top.append("이슈")
            label = f"{'·'.join(top[:2])} 관련 뉴스"
            if len(label) < 8:
                label = f"{'·'.join(top[:3])} 관련 보도"
            summary = (
                f"이 군집은 {', '.join(top[:3])} 등의 키워드를 주로 다루는 뉴스 모음입니다. "
                f"대표적인 보도로 '{members[0]['title']}' 등이 포함됩니다."
            )
            dist = {
                "pos": sum(1 for a in members if a["sentiment"] == "pos"),
                "neu": sum(1 for a in members if a["sentiment"] == "neu"),
                "neg": sum(1 for a in members if a["sentiment"] == "neg"),
            }
        else:
            avg_x = avg_y = 0.0
            label, summary, top = f"군집 {cid}", "이 군집에 해당하는 뉴스가 없습니다.", ["뉴스", "보도", "이슈"]
            dist = {"pos": 0, "neu": 0, "neg": 0}
        clusters.append({
            "id": cid, "label": label, "summary": summary, "keywords": top[:5],
            "size": size, "centroid": {"x": round(avg_x, 4), "y": round(avg_y, 4)},
            "sentiment_dist": dist,
        })

    # ---- meta / trends 재집계 ----
    dates = [a["published_at"] for a in combined]
    date_from, date_to = min(dates), max(dates)
    start = datetime.strptime(date_from, "%Y-%m-%d")
    end = datetime.strptime(date_to, "%Y-%m-%d")
    all_dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range((end - start).days + 1)]

    kw_counter = Counter()
    for a in combined:
        for kw in a["keywords"]:
            kw_counter[kw] += 1
    trends = []
    for kw, _ in kw_counter.most_common(20):
        series_map = {d: 0 for d in all_dates}
        for a in combined:
            if a["published_at"] in series_map and kw in a["keywords"]:
                series_map[a["published_at"]] += 1
        trends.append({"keyword": kw, "series": [{"date": d, "count": series_map[d]} for d in all_dates]})

    meta = {
        "source_name": "연합뉴스",
        "collected_at": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "date_from": date_from,
        "date_to": date_to,
        "article_count": len(combined),
        "cluster_count": 6,
    }
    final = {"meta": meta, "clusters": clusters, "articles": combined, "trends": trends}
    emb_out = {"model": old_model, "dim": EMBED_DIM,
               "items": sorted([{"id": i, "v": emb_by_id[i]} for i in ids], key=lambda x: x["id"])}

    # ---- 검증: placeholder/보일러플레이트 0건 + pydantic ----
    bad = [(a["id"], s) for a in combined for s in a["summary3"] if has_bad_text(s)]
    if bad:
        print(f"[중단] placeholder/보일러플레이트 {len(bad)}건 발견 (미반영): {bad[:3]}")
        sys.exit(1)

    from schemas import ArticlesFileModel, EmbeddingsFileModel
    from pydantic import ValidationError
    try:
        ArticlesFileModel(**{**final, "articles": [{**a, "summary3": tuple(a["summary3"])} for a in combined]})
        EmbeddingsFileModel(**emb_out)
    except ValidationError as e:
        print(f"[중단] pydantic 검증 실패 (미반영):\n{e}")
        sys.exit(1)

    json.dump(final, open(OLD_ARTICLES, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(emb_out, open(OLD_EMB, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("=" * 60)
    print(f"✅ 병합 완료: 기존 {len(old_articles)} + 신규 {len(new_records)} = {len(combined)}건")
    print(f"   기간 {date_from} ~ {date_to} | 논조 " +
          f"pos {sum(1 for a in combined if a['sentiment']=='pos')}/"
          f"neu {sum(1 for a in combined if a['sentiment']=='neu')}/"
          f"neg {sum(1 for a in combined if a['sentiment']=='neg')}")
    print(f"   articles.json·embeddings.json 반영. 다음: create_graph.py로 graph.json 재생성.")


if __name__ == "__main__":
    main()
