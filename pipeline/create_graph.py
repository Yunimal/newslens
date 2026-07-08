import os
import sys
import json
from collections import Counter, defaultdict
import itertools

# Windows 콘솔 유니코드 출력 처리
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

ARTICLES_FILE = "data/articles.json"
GRAPH_FILE = "data/graph.json"

def main():
    print("==================================================")
    print("[NewsLens] 관계망(Graph) 데이터 생성 시작")
    print("==================================================")

    # 1. 파일 존재 여부 확인
    if not os.path.exists(ARTICLES_FILE):
        print(f"[에러] '{ARTICLES_FILE}' 파일이 존재하지 않습니다.")
        return

    with open(ARTICLES_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    articles = data.get("articles", [])
    print(f"총 {len(articles)}개의 기사를 로드했습니다.")

    # 2. 엔티티 타입 제한 (PER, ORG, LOC) 및 기사별 고유 엔티티 수집
    allowed_types = {"PER", "ORG", "LOC"}
    
    # entity_name -> type 매핑 (타입 일관성을 위해 다수결 혹은 우선 지정)
    entity_types = {}
    entity_type_counts = defaultdict(Counter)  # name -> {type: count}
    
    # entity_name -> article_ids 매핑
    entity_articles = defaultdict(set)
    
    # 기사별로 엔티티 목록 정제하여 저장
    cleaned_articles_entities = []
    
    for art in articles:
        art_id = art.get("id")
        entities = art.get("entities", [])
        
        # 한 기사 내에서 중복 제거 및 타입 필터링
        seen_in_art = set()
        
        for ent in entities:
            name = ent.get("name", "").strip()
            ent_type = ent.get("type", "").strip().upper()
            
            if not name or ent_type not in allowed_types:
                continue
                
            seen_in_art.add(name)
            entity_type_counts[name][ent_type] += 1
            
        # 기사별 유니크 엔티티 세트 생성
        for name in seen_in_art:
            entity_articles[name].add(art_id)
            
        cleaned_articles_entities.append((art_id, list(seen_in_art)))

    # 각 엔티티의 대표 타입 결정 (가장 빈도가 높은 타입으로 결정)
    for name, type_counter in entity_type_counts.items():
        best_type = type_counter.most_common(1)[0][0]
        entity_types[name] = best_type

    if not entity_articles:
        print("[경고] 수집된 엔티티가 없어 빈 그래프 파일을 생성합니다.")
        output_data = {"nodes": [], "edges": []}
        with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        return

    # 3. nodes[] 생성 (빈도 상위 60개 엔티티 제한)
    # 빈도수 = 등장 기사 수 (len(entity_articles[name]))
    entity_counts = {name: len(articles_set) for name, articles_set in entity_articles.items()}
    
    # 상위 60개 추출 (빈도 내림차순, 빈도 같으면 이름 오름차순으로 결정론적 정렬)
    sorted_entities = sorted(entity_counts.items(), key=lambda x: (-x[1], x[0]))
    top_60_pairs = sorted_entities[:60]
    top_60_names = set(name for name, _ in top_60_pairs)

    print(f"수집된 고유 엔티티 수: {len(entity_counts)}개")
    print(f"상위 60개 노드 선정 완료 (최소 빈도: {top_60_pairs[-1][1]}회)")

    nodes = []
    for name, count in top_60_pairs:
        nodes.append({
            "id": name,
            "type": entity_types[name],
            "count": count,
            "article_ids": sorted(list(entity_articles[name]))
        })

    # 4. edges[] 생성 (weight >= 2 제한)
    # edges_map: (source, target) -> set of article_ids
    edges_map = defaultdict(set)
    
    for art_id, art_ents in cleaned_articles_entities:
        # 상위 60개 노드에 속한 엔티티만 남김
        valid_ents = [name for name in art_ents if name in top_60_names]
        
        # 2개 이상일 때만 쌍 조합 가능
        if len(valid_ents) >= 2:
            for ent1, ent2 in itertools.combinations(valid_ents, 2):
                # 알파벳/사전 순 정렬하여 중복 제거
                source, target = sorted([ent1, ent2])
                edges_map[(source, target)].add(art_id)

    edges = []
    for (source, target), art_ids in edges_map.items():
        weight = len(art_ids)
        if weight >= 2:
            edges.append({
                "source": source,
                "target": target,
                "weight": weight,
                "article_ids": sorted(list(art_ids))
            })

    # weight 내림차순 정렬, 같으면 source 오름차순, target 오름차순 정렬
    edges.sort(key=lambda x: (-x["weight"], x["source"], x["target"]))
    print(f"최종 엣지 수 (weight >= 2): {len(edges)}개")

    # 5. data/graph.json 저장
    output_data = {
        "nodes": nodes,
        "edges": edges
    }
    
    with open(GRAPH_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    print(f"[성공] '{GRAPH_FILE}' 파일이 정상적으로 저장되었습니다.")

    print("\n==================================================")
    print("[완료] 관계망(Graph) 파이프라인 처리가 성공적으로 종료되었습니다.")
    print("==================================================")



if __name__ == "__main__":
    main()
