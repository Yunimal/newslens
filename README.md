# NewsLens

뉴스를 다양한 관점(lens)으로 분석·질의하는 웹 애플리케이션입니다.
Next.js(App Router, TypeScript, Tailwind CSS) 프론트엔드와 Python 데이터 파이프라인으로 구성됩니다.

## 폴더 구조

```
.
├── app/                # Next.js App Router
│   ├── api/
│   │   └── ask/        # 질의 응답 API 라우트
│   └── components/     # UI 컴포넌트
├── pipeline/           # Python 데이터 수집/전처리 파이프라인
│   ├── requirements.txt
│   ├── cache/          # (gitignore) 파이프라인 캐시
│   └── raw/            # (gitignore) 원본 수집 데이터
├── data/               # 가공된 데이터셋
├── types/
│   └── schema.ts       # 공용 타입 정의
├── public/             # 정적 자산
├── .env.example        # 환경 변수 예시 (OPENAI_API_KEY)
└── ...                 # Next.js 설정 파일들
```

## 시작하기

```bash
# 환경 변수 설정
cp .env.example .env.local   # OPENAI_API_KEY 입력

# 의존성 설치 및 개발 서버 실행
npm install
npm run dev
```

개발 서버 실행 후 [http://localhost:3000](http://localhost:3000)에서 확인할 수 있습니다.

### 파이프라인

```bash
cd pipeline
pip install -r requirements.txt
```

## 기술 스택

- **프론트엔드**: Next.js (App Router), TypeScript, Tailwind CSS
- **데이터 파이프라인**: Python
- **LLM**: OpenAI API
