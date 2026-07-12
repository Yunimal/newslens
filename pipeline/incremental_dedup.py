"""
[증분 수집 1/2] 오늘 수집한 raw 배치에서 '기존 data/articles.json에 이미 있는 URL'을 제거한다.
이후 enrich/embed 단계가 신규 기사에만 GPT를 호출하도록(비용·시간 절약, 기존 결과 보존)
raw/raw_articles_500.json 을 신규 전용으로 덮어쓴다.

- 중복 판정 기준: 기사 URL (쿼리스트링·끝 슬래시 정규화 후 완전 일치)
- 기존 것은 건드리지 않는다. 여기서는 '오늘 배치 축소'만 한다.
"""
import os
import sys
import json

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

OLD_ARTICLES = "data/articles.json"
NEW_RAW = "pipeline/raw/raw_articles_500.json"


def norm_url(u: str) -> str:
    if not u:
        return ""
    u = u.split("?")[0].strip()
    return u[:-1] if u.endswith("/") else u


def main():
    if not os.path.exists(NEW_RAW):
        print(f"[에러] 오늘 수집 결과 '{NEW_RAW}'가 없습니다. collect_sample.py를 먼저 실행하세요.")
        sys.exit(1)
    if not os.path.exists(OLD_ARTICLES):
        print(f"[에러] 기존 '{OLD_ARTICLES}'가 없습니다. 증분 병합의 기준 데이터가 필요합니다.")
        sys.exit(1)

    old = json.load(open(OLD_ARTICLES, encoding="utf-8"))
    old_urls = {norm_url(a.get("url", "")) for a in old.get("articles", [])}

    today = json.load(open(NEW_RAW, encoding="utf-8"))
    print(f"오늘 수집 {len(today)}건 · 기존 기사 {len(old_urls)}건과 URL 대조...")

    seen = set()
    new_only = []
    dup = 0
    for art in today:
        u = norm_url(art.get("url", ""))
        if not u or u in old_urls or u in seen:
            dup += 1
            continue
        seen.add(u)
        new_only.append(art)

    json.dump(new_only, open(NEW_RAW, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"신규 기사 {len(new_only)}건 · 기존/중복 제외 {dup}건")
    print(f"→ '{NEW_RAW}'를 신규 전용({len(new_only)}건)으로 덮어썼습니다. 이제 enrich/embed는 신규만 처리합니다.")
    # 신규가 0건이면 이후 단계가 무의미하므로 별도 종료코드로 알린다.
    if not new_only:
        print("[정보] 신규 기사가 0건입니다 — 오늘 수집분이 모두 기존 데이터에 존재합니다.")
        sys.exit(2)


if __name__ == "__main__":
    main()
