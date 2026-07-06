import os
import re
import json
import hashlib
import requests
import feedparser
from bs4 import BeautifulSoup
from datetime import datetime

MAIN_RSS_URL = "https://www.yna.co.kr/rss/news.xml"

def clean_text(text):
    """뉴스 본문 내부의 불필요한 공백 및 이물질 전처리"""
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def fetch_main_sample_articles(target_count=30):
    print(f"연합뉴스 메인 통합 RSS 피드 분석 중: {MAIN_RSS_URL}")
    feed = feedparser.parse(MAIN_RSS_URL)
    
    sampled_articles = []
    count = 0
    
    for entry in feed.entries:
        if count >= target_count:
            break
            
        article_url = entry.link
        article_id = hashlib.sha256(article_url.encode('utf-8')).hexdigest()[:16]
        
        try:
            dt = datetime.strptime(entry.published, '%a, %d %b %Y %H:%M:%S %z')
            published_at = dt.isoformat()
        except Exception:
            published_at = entry.published

        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
            resp = requests.get(article_url, headers=headers, timeout=5)
            
            if resp.status_code == 200:
                soup = BeautifulSoup(resp.content, 'html.parser')

                content_div = soup.select_one('div.article-body') or soup.select_one('article')
                
                if content_div:
                    for s in content_div(['script', 'style', 'iframe', 'button']):
                        s.decompose()
                    raw_content = content_div.get_text()
                    content = clean_text(raw_content)
                else:
                    content = "본문 파싱 실패"
            else:
                content = f"접속 실패 (Status: {resp.status_code})"
                
        except Exception as e:
            content = f"에러 발생: {str(e)}"

        article_obj = {
            "id": article_id,
            "title": entry.title,
            "url": article_url,
            "publishedAt": published_at,
            "content": content,
            "summary": [],         
            "category": "미분류",  
            "sentiment": "neutral",
            "entities": []         
        }
        
        sampled_articles.append(article_obj)
        count += 1
        print(f"   -> 수집 완료 ({count}/{target_count}): {entry.title[:20]}...")

    output_dir = 'pipeline/raw'
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, 'sample_30.json')
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(sampled_articles, f, ensure_ascii=False, indent=2)
        
    print(f"\n연합뉴스 샘플 30건 '{output_path}'에 저장되었습니다.")

if __name__ == "__main__":
    fetch_main_sample_articles()