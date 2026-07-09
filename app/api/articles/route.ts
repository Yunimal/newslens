// app/api/articles/route.ts
// 클라이언트용 기사 인덱스 제공 라우트. 프론트(D)가 source_ids로 근거 카드를 렌더링하려면
// id→Article 조회가 필요하다. 서버 전용 로더(getCorpus)를 재사용해 mock/real 스위칭 로직을
// 그대로 물려받되, 응답에는 공개 데이터(ArticlesFile: meta·clusters·articles·trends)만 담는다.
// embeddings.json(서버 전용 벡터)은 corpus.vectors에만 있고 여기서 직렬화하지 않으므로 유출되지 않는다.
//
// ⚠️ app/api/ask/ 는 수정하지 않는다 — 오직 import만 한다(계약 준수).

import { getCorpus } from "../ask/lib/data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const corpus = await getCorpus();
    // corpus.articles 는 ArticlesFile 그대로 (embeddings 미포함).
    return Response.json(corpus.articles, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (e) {
    console.error("[/api/articles]", e);
    return Response.json({ error: "기사 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}
