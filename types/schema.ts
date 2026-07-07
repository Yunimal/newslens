// types/schema.ts — FROZEN CONTRACT (스키마 문서 v1.0, 2026-07-06 동결).
// 프론트엔드(A/C/D)와 백엔드(B)가 공유하는 단일 진실 원천. import via "@/types/schema".
// 런타임 코드 없음 · server-only import 없음 → 클라이언트 번들에서도 안전.
//
// ⚠️ 이 파일은 동결된 스키마 문서를 그대로 코드화한 것입니다. 필드 변경은
//    스키마 문서의 변경 절차(제안→전원 승인→schemas.py/schema.ts 동시 수정 PR→이력 기록)를
//    거쳐야 합니다.

export type Sentiment = "pos" | "neu" | "neg";
export type EntityType = "PER" | "ORG" | "LOC";

/* ---------- data/articles.json (클라이언트 공개) ---------- */

export interface Meta {
  source_name: string;
  collected_at: string; // ISO 8601 (시간 포함은 이 필드뿐)
  date_from: string; // "YYYY-MM-DD"
  date_to: string; // "YYYY-MM-DD"
  article_count: number;
  cluster_count: number;
}

export interface Entity {
  name: string;
  type: EntityType;
}

export interface Article {
  id: string; // "a" + 4자리, 예: "a0001"
  title: string;
  url: string;
  press: string;
  published_at: string; // "YYYY-MM-DD"
  category: string;
  summary3: [string, string, string]; // 정확히 3문장 · 본문 전문은 절대 저장 안 함
  topic_tags: string[]; // 1~3개
  sentiment: Sentiment;
  keywords: string[]; // 3~5개
  entities: Entity[]; // 빈 배열 허용
  cluster_id: number;
  x: number;
  y: number;
}

export interface Cluster {
  id: number; // 0부터
  label: string;
  summary: string; // 2~3문장
  keywords: string[]; // 3~5개
  size: number;
  centroid: { x: number; y: number };
  sentiment_dist: { pos: number; neu: number; neg: number };
}

export interface TrendPoint {
  date: string; // "YYYY-MM-DD"
  count: number;
}
export interface Trend {
  keyword: string;
  series: TrendPoint[]; // 0인 날 포함
}

export interface ArticlesFile {
  meta: Meta;
  clusters: Cluster[];
  articles: Article[];
  trends: Trend[];
}

/* ---------- data/graph.json (클라이언트 공개 · 관계망) ---------- */

export interface GraphNode {
  id: string; // 엔티티 이름 = 키 (빈도 상위 60개)
  type: EntityType;
  count: number;
  article_ids: string[];
}
export interface GraphEdge {
  source: string; // 노드 id
  target: string; // 노드 id
  weight: number; // 동시출현 기사 수 (>= 2만)
  article_ids: string[];
}
export interface GraphFile {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/* ---------- data/embeddings.json (⚠️ 서버 전용 · 클라이언트 전송 금지) ---------- */

export interface EmbeddingItem {
  id: string; // Article.id와 매칭
  v: number[]; // 길이 512, 소수점 4자리 반올림
}
export interface EmbeddingsFile {
  model: string; // "text-embedding-3-small"
  dim: 512;
  items: EmbeddingItem[];
}

/* ---------- POST /api/ask ---------- */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskRequest {
  question: string;
  history?: ChatTurn[]; // 직전 대화 최대 3턴
  focus_article_id?: string; // 기사 카드 "질문하기" 진입 시
}

export interface AskResponse {
  answer: string; // 브리핑 답변. 본문에 근거를 [a0001] 형식으로 인라인 표기
  source_ids: string[]; // 실제 인용된 기사 id (검색된 컨텍스트와 교집합)
  no_result: boolean; // true면 answer는 "수집 범위 내 관련 기사 없음" 안내문
}

export interface AskError {
  error: string; // 사용자용 안내 문구(한국어). 프론트는 [다시 시도] 버튼 노출
}
