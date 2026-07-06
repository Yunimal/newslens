import os
import re
import json
import hashlib
import requests
import random
import time
import copy
from bs4 import BeautifulSoup
from datetime import datetime

# Anti-Bot 방지를 위한 User-Agent 풀
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
]

def clean_text(text):
    """뉴스 본문 내부의 불필요한 공백, 포토 캡션, 저작권 문구 등 노이즈 전처리"""
    # 1. 괄호 안의 포토/미디어 캡션 제거 [description... 제공/금지/자료사진/재판매/DB]
    caption_pattern = r'\[[^\]]*?(?:제공|금지|자료사진|재판매|DB)[^\]]*?\]'
    text = re.sub(caption_pattern, '', text)
    
    # 2. 이메일 주소 제거
    email_pattern = r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
    text = re.sub(email_pattern, '', text)
    
    # 3. 저작권 관련 고정 문구 제거
    copyright_pattern = r'<저작권자\(c\)\s*연합뉴스,\s*무단\s*전재-재배포,\s*AI\s*학습\s*및\s*활용\s*금지>'
    text = re.sub(copyright_pattern, '', text)
    
    # 4. 제보 및 채널 안내 제거
    report_pattern = r'제보는\s+카카오톡\s+\w+'
    text = re.sub(report_pattern, '', text)
    
    # 5. 송고 시간 관련 문구 제거
    songgo_pattern = r'\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}\s+송고'
    text = re.sub(songgo_pattern, '', text)
    songgo_pattern_ko = r'\d{4}년\s*\d{2}월\s*\d{2}일\s*\d{2}시\s*\d{2}분\s*송고'
    text = re.sub(songgo_pattern_ko, '', text)
    
    # 6. 관련 뉴스 블록 제거
    text = re.sub(r'관련 뉴스\s+.*?(?:\n|$)', '', text, flags=re.DOTALL)
    
    # 7. 해시태그 제거
    text = re.sub(r'#\w+', '', text)
    
    # 8. 마케팅성 하단 배너 및 문구 제거
    boilerplates = [
        r'국내\s*최대\s*원스톱\s*콘텐츠\s*제공\s*플랫폼',
        r'함께\s*보면\s*좋은\s*콘텐츠\s*by\s*데이블',
        r'함께\s*읽기\s*좋은\s*콘텐츠\s*Taboola\s*후원링크',
        r'공유하기\s*URL이\s*복사되었습니다\.?',
        r'본문\s*글자\s*크기\s*조정',
        r'제보\s*$',
        r'광고\s*'
    ]
    for bp in boilerplates:
        text = re.sub(bp, '', text, flags=re.IGNORECASE)
        
    # 9. 연속된 공백 및 줄바꿈 정리
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def get_article_links(pages=20):
    """
    최신 뉴스 목록 페이지들을 돌며 기사 상세 URL을 추출 및 중복 제거
    """
    links = []
    print(f"=== 1단계: 최신 기사 URL 목록 수집 시작 (총 {pages}페이지) ===")
    
    headers = {'User-Agent': random.choice(USER_AGENTS)}
    
    for page in range(1, pages + 1):
        url = f"https://www.yna.co.kr/news/{page}?site=navi_latest_depth01"
        print(f"   -> [{page}/{pages}] 목록 페이지 분석 중: {url}")
        
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code != 200:
                print(f"      [경고] {page}페이지 접속 실패 (Status: {resp.status_code})")
                time.sleep(0.5)
                continue
                
            soup = BeautifulSoup(resp.content, "html.parser")
            page_links_count = 0
            
            for a in soup.find_all("a", href=True):
                href = a["href"]
                # 상세 기사 링크(/view/) 필터링
                if "/view/" in href:
                    # 절대 경로 결합
                    if href.startswith("//"):
                        full_url = "https:" + href
                    elif href.startswith("/"):
                        full_url = "https://www.yna.co.kr" + href
                    else:
                        full_url = href
                        
                    # 쿼리 매개변수 제거
                    if "?" in full_url:
                        full_url = full_url.split("?")[0]
                        
                    if full_url not in links:
                        links.append(full_url)
                        page_links_count += 1
            
            print(f"      -> 새 기사 {page_links_count}건 추가됨 (누적: {len(links)}건)")
            
        except Exception as e:
            print(f"      [에러] {page}페이지 처리 중 오류 발생: {str(e)}")
            
        time.sleep(0.5)
        
    print(f"=== 1단계 완료: 총 {len(links)}개의 고유 기사 URL 수집 완료 ===\n")
    return links

def extract_article_id(url):
    """URL에서 연합뉴스 고유 기사 ID 추출"""
    parts = url.split("/")
    last_part = parts[-1].split("?")[0]
    if last_part:
        return last_part
    # 매칭 실패 시 SHA256 해시값 반환
    return hashlib.sha256(url.encode('utf-8')).hexdigest()[:16]

def scrape_article_detail(url):
    """
    개별 기사 URL에서 제목, 발행일, 정제된 본문 텍스트를 추출
    """
    headers = {'User-Agent': random.choice(USER_AGENTS)}
    resp = requests.get(url, headers=headers, timeout=10)
    resp.encoding = 'utf-8'
    
    if resp.status_code != 200:
        raise Exception(f"HTTP {resp.status_code}")
        
    soup = BeautifulSoup(resp.text, "html.parser")
    
    # 1. 제목 추출
    title = ""
    title_el = soup.find('h1') or soup.select_one('h1.tit01') or soup.select_one('h1.tit-article') or soup.select_one('h1.title-article')
    if title_el:
        title = title_el.get_text(strip=True)
    else:
        og_title = soup.find("meta", property="og:title")
        if og_title:
            title = og_title.get("content", "").strip()
            
    # 연합뉴스 타이틀 접미사 제거
    if title.endswith(" | 연합뉴스"):
        title = title[:-8]
        
    # 2. 발행일 추출
    published_at = ""
    pub_time_meta = soup.find("meta", property="article:published_time") or soup.find("meta", name="pubdate")
    if pub_time_meta:
        published_at = pub_time_meta.get("content", "").strip()
    else:
        time_el = soup.select_one('.update-time') or soup.select_one('.txt-time01') or soup.select_one('.date')
        if time_el:
            published_at = time_el.get_text(strip=True)
            
    # 3. 본문 추출 및 노이즈 제거
    content = ""
    content_div = soup.select_one('div.article-body') or soup.select_one('article') or soup.select_one('.story-news')
    if content_div:
        # 원본 유지 보존을 위해 깊은 복사 사용
        content_copy = copy.copy(content_div)
        # 본문 영역 내부의 불필요한 태그 제거 (스크립트, 스타일, 아이프레임, 이미지 설명 캡션 등)
        for s in content_copy(['script', 'style', 'iframe', 'button', 'figcaption', 'ins', 'figure', 'span.img-desc']):
            s.decompose()
        content = content_copy.get_text()
    else:
        raise Exception("본문 영역(article-body)을 찾을 수 없습니다.")
        
    cleaned_content = clean_text(content)
    
    return {
        "title": title,
        "publishedAt": published_at,
        "content": cleaned_content
    }

def collect_500_articles(target_count=500):
    """
    500개 기사 수집 파이프라인 메인 실행 제어기
    """
    # 저장 디렉토리 생성
    os.makedirs('pipeline/cache', exist_ok=True)
    os.makedirs('pipeline/raw', exist_ok=True)
    
    # 1단계: URL 목록 수집
    urls = get_article_links(pages=20)
    
    # 목표 수량으로 자르기
    urls = urls[:target_count]
    total_urls = len(urls)
    print(f"최종 수집 대상 기사 수: {total_urls}건\n")
    
    print("=== 2단계: 기사 본문 상세 수집 시작 ===")
    
    # 2단계: 개별 기사 상세 수집 및 캐싱
    for index, url in enumerate(urls, 1):
        article_id = extract_article_id(url)
        cache_path = f"pipeline/cache/article_{article_id}.json"
        
        # 캐싱 처리: 파일이 이미 존재하면 건너뜀
        if os.path.exists(cache_path):
            print(f"[{index}/{total_urls}] [캐시] 이미 수집된 기사입니다. (ID: {article_id})")
            continue
            
        # 서버 부하 방지를 위한 랜덤 딜레이 적용 (0.5 ~ 1.2초)
        time.sleep(random.uniform(0.5, 1.2))
        
        try:
            detail = scrape_article_detail(url)
            
            article_obj = {
                "id": article_id,
                "title": detail["title"],
                "url": url,
                "publishedAt": detail["publishedAt"],
                "content": detail["content"]
            }
            
            # 개별 기사 로컬 파일 즉시 저장 (캐싱)
            with open(cache_path, 'w', encoding='utf-8') as f:
                json.dump(article_obj, f, ensure_ascii=False, indent=2)
                
            print(f"[{index}/{total_urls}] [성공] {detail['title'][:30]}... (ID: {article_id})")
            
        except Exception as e:
            print(f"[{index}/{total_urls}] [실패] {url} 수집 중 오류 발생: {str(e)}")
            
    print("\n=== 3단계: 캐시 파일 병합 시작 ===")
    
    # 3단계: 개별 캐시 파일들 병합
    merged_articles = []
    for url in urls:
        article_id = extract_article_id(url)
        cache_path = f"pipeline/cache/article_{article_id}.json"
        if os.path.exists(cache_path):
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    article_obj = json.load(f)
                    merged_articles.append(article_obj)
            except Exception as e:
                print(f"[경고] 캐시 파일 읽기 실패 ({cache_path}): {str(e)}")
                
    # 최종 결과 파일 저장
    output_path = 'pipeline/raw/raw_articles_500.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(merged_articles, f, ensure_ascii=False, indent=2)
        
    print(f"\n=== 최종 수집 완료: 총 {len(merged_articles)}건의 정제된 기사를 '{output_path}'에 저장했습니다. ===")

if __name__ == "__main__":
    collect_500_articles()