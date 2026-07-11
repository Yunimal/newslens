// app/api/graph/route.ts
// 클라이언트용 엔티티 관계망 제공 라우트. data/graph.json(노드·엣지)을 그대로 반환한다.
// getCorpus()(app/api/ask/lib/data.ts)는 articles+embeddings만 다루고 graph는 포함하지
// 않으므로, 여기서는 그 모듈을 건드리지 않고 별도로 읽는다.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GraphFile } from "@/types/schema";

export const runtime = "nodejs";

export async function GET() {
  try {
    const raw = await readFile(resolve(process.cwd(), "data", "graph.json"), "utf8");
    const graph = JSON.parse(raw) as GraphFile;
    return Response.json(graph, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (e) {
    console.error("[/api/graph]", e);
    return Response.json({ error: "관계망 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}
