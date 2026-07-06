// app/api/ask/lib/data.ts
// 서버 전용 코퍼스 로더. articles + embeddings JSON을 읽어 파싱하고,
// 각 벡터의 norm을 미리 계산해 모듈 스코프에 캐시(warm invocation 간 재사용).
// embeddings는 클라이언트로 절대 나가면 안 되므로 이 파일은 server-only.

import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Article, ArticlesFile, EmbeddingsFile } from "@/types/schema";

const dataDir = resolve(process.cwd(), "data");

const fileExists = (f: string): Promise<boolean> =>
  readFile(resolve(dataDir, f)).then(
    () => true,
    () => false,
  );

/**
 * 사용할 데이터 파일 결정.
 * - NEWSLENS_USE_MOCK=1 → 항상 mock
 * - 그 외 → 실데이터(articles.json + embeddings.json)가 둘 다 있으면 실데이터
 * - 없으면 mock으로 폴백(경고) → A의 실데이터가 도착하면 플래그만 내리면 됨(코드 변경 0)
 */
async function pickFiles(): Promise<[string, string]> {
  if (process.env.NEWSLENS_USE_MOCK === "1") {
    return ["articles.mock.json", "embeddings.mock.json"];
  }
  const real = (await fileExists("articles.json")) && (await fileExists("embeddings.json"));
  if (real) return ["articles.json", "embeddings.json"];
  console.warn("[newslens] real data not found — falling back to mock data");
  return ["articles.mock.json", "embeddings.mock.json"];
}

export interface CorpusVector {
  id: string;
  vec: number[];
  norm: number;
}

export interface Corpus {
  articles: ArticlesFile;
  byId: Map<string, Article>;
  vectors: CorpusVector[];
  usingMock: boolean;
  embedModel: string; // embeddings 파일이 밝힌 임베더(provenance). 질의 임베더/임계치 선택 기준
}

let cache: Promise<Corpus> | null = null;

export function getCorpus(): Promise<Corpus> {
  if (!cache) {
    const build = (async (): Promise<Corpus> => {
      const [af, ef] = await pickFiles();
      const articles = JSON.parse(await readFile(resolve(dataDir, af), "utf8")) as ArticlesFile;
      const embeddings = JSON.parse(await readFile(resolve(dataDir, ef), "utf8")) as EmbeddingsFile;

      const byId = new Map(articles.articles.map((a) => [a.id, a]));
      const vectors: CorpusVector[] = embeddings.items.map((it) => ({
        id: it.id,
        vec: it.v,
        norm: Math.sqrt(it.v.reduce((s, x) => s + x * x, 0)),
      }));

      return { articles, byId, vectors, usingMock: af.includes("mock"), embedModel: embeddings.model };
    })();
    // 실패한 promise를 캐시에 남기지 않는다 — 일시적 read/parse 실패가 warm 인스턴스 전체를
    // 500으로 오염시키는 것 방지(리뷰 #3). 다음 요청이 재시도하도록 캐시를 비운다.
    build.catch(() => {
      cache = null;
    });
    cache = build;
  }
  return cache;
}
