"use client";

// 기사 인덱스 로더 훅. /api/articles 를 앱 최초 1회만 fetch 하고(모듈 스코프 promise 캐시),
// 이후 모든 컴포넌트가 같은 결과를 재사용한다. source_ids → Article 조회용 id→Article Map 제공.
// 서버 전용 embeddings 는 여기에 들어오지 않는다(라우트가 ArticlesFile 만 반환).

import { useEffect, useState } from "react";
import type { Article, ArticlesFile, Cluster } from "@/types/schema";

let cache: Promise<ArticlesFile> | null = null;

function loadArticles(): Promise<ArticlesFile> {
  if (!cache) {
    const p = fetch("/api/articles")
      .then((r) => {
        if (!r.ok) throw new Error(`기사 인덱스 로드 실패: HTTP ${r.status}`);
        return r.json() as Promise<ArticlesFile>;
      });
    // 실패한 promise 는 캐시에 남기지 않는다 — 다음 마운트가 재시도하도록.
    p.catch(() => {
      cache = null;
    });
    cache = p;
  }
  return cache;
}

export interface ArticleIndex {
  byId: Map<string, Article>;
  clusters: Cluster[];
  loading: boolean;
  error: string | null;
}

export function useArticles(): ArticleIndex {
  const [state, setState] = useState<ArticleIndex>({
    byId: new Map(),
    clusters: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    loadArticles()
      .then((file) => {
        if (!alive) return;
        setState({
          byId: new Map(file.articles.map((a) => [a.id, a])),
          clusters: file.clusters,
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : "기사 인덱스를 불러오지 못했습니다.",
        }));
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
