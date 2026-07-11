"use client";

// 관계망 데이터 로더 훅. useArticles와 동일한 패턴 — /api/graph를 앱 최초 1회만 fetch하고
// (모듈 스코프 promise 캐시), 이후 모든 컴포넌트가 같은 결과를 재사용한다.

import { useEffect, useState } from "react";
import type { GraphFile } from "@/types/schema";

let cache: Promise<GraphFile> | null = null;

function loadGraph(): Promise<GraphFile> {
  if (!cache) {
    const p = fetch("/api/graph").then((r) => {
      if (!r.ok) throw new Error(`관계망 데이터 로드 실패: HTTP ${r.status}`);
      return r.json() as Promise<GraphFile>;
    });
    p.catch(() => {
      cache = null;
    });
    cache = p;
  }
  return cache;
}

export interface GraphIndex {
  nodes: GraphFile["nodes"];
  edges: GraphFile["edges"];
  loading: boolean;
  error: string | null;
}

export function useGraph(): GraphIndex {
  const [state, setState] = useState<GraphIndex>({
    nodes: [],
    edges: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let alive = true;
    loadGraph()
      .then((file) => {
        if (!alive) return;
        setState({ nodes: file.nodes, edges: file.edges, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : "관계망 데이터를 불러오지 못했습니다.",
        }));
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}
