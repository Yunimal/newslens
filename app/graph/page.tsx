"use client";

// 인물·기관 관계망 개발/테스트용 페이지. /map, /trends와 동일한 목적.

import { useMemo, useState } from "react";
import { useGraph } from "../lib/useGraph";
import { useArticles } from "../lib/useArticles";
import { EntityGraph, TYPE_COLOR, TYPE_LABEL } from "../components/EntityGraph";
import { ArticleCard } from "../components/ArticleCard";
import type { Article } from "@/types/schema";

const RELATED_ARTICLE_PAGE = 10;
const CONNECTED_ENTITY_LIMIT = 6;

export default function GraphDevPage() {
  const { nodes, edges, loading, error } = useGraph();
  const { byId } = useArticles();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(RELATED_ARTICLE_PAGE);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  // 노드를 바꿔서 선택할 때마다 "더보기"로 늘려놨던 개수를 초기값으로 되돌린다 —
  // 이전 엔티티에서 40건까지 펼쳐봤다고 다음 엔티티도 40건부터 시작하면 안 된다.
  const handleSelectNode = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setVisibleCount(RELATED_ARTICLE_PAGE);
  };

  const relatedArticles = useMemo(() => {
    if (!selectedNode) return [];
    return selectedNode.article_ids
      .map((id) => byId.get(id))
      .filter((a): a is Article => Boolean(a))
      .sort((a, b) => b.published_at.localeCompare(a.published_at));
  }, [selectedNode, byId]);

  const shownArticles = relatedArticles.slice(0, visibleCount);
  const remainingCount = relatedArticles.length - shownArticles.length;

  // 선택된 노드와 동시출현 가중치가 높은 순으로 연결된 엔티티 — 기사 스크롤 없이도
  // "이 사람/기관이 주로 누구와 엮이는지" 바로 보이도록. type도 같이 찾아둬서 칩 색을
  // 그래프 노드와 동일하게(인물=주황·기관=파랑·지역=초록) 칠할 수 있게 한다.
  const connectedEntities = useMemo(() => {
    if (!selectedNode) return [];
    return edges
      .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
      .map((e) => {
        const id = e.source === selectedNode.id ? e.target : e.source;
        return { id, weight: e.weight, type: nodes.find((n) => n.id === id)?.type };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, CONNECTED_ENTITY_LIMIT);
  }, [selectedNode, edges, nodes]);

  return (
    <main className="flex h-screen w-full overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-4">
          <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
            인물·기관·지역 관계망
            <span
              title="기사 본문에서 함께 등장한 인물·기관·지역을 노드-엣지 그래프로 보여줍니다. 노드 크기는 등장 횟수, 선 굵기는 동시출현 빈도입니다."
              className="cursor-help text-base text-slate-500"
            >
              ⓘ
            </span>
          </h1>
          {!loading && !error && (
            <p className="mt-1 text-sm text-slate-400">
              총 {nodes.length}개 노드, {edges.length}개 연결 (동시출현 기반)
            </p>
          )}
        </div>
        {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
        {!loading && !error && (
          <div className="min-h-0 flex-1">
            <EntityGraph
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
            />
          </div>
        )}
      </div>

      <aside className="w-96 shrink-0 overflow-y-auto border-l border-white/10 p-6">
        {!selectedNode && (
          <p className="text-sm leading-6 text-slate-400">
            노드를 클릭하면 관련 기사가 여기 표시됩니다. 마우스를 올리면 연결된 관계만 강조됩니다.
          </p>
        )}
        {selectedNode && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-white">{selectedNode.id}</h2>
                <p className="text-xs text-slate-500">
                  {TYPE_LABEL[selectedNode.type]} · {selectedNode.count}건
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleSelectNode(null)}
                aria-label="선택 해제"
                className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-sm text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                ×
              </button>
            </div>

            {connectedEntities.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-slate-400">연결된 주요 인물·기관·지역</p>
                <div className="flex flex-wrap gap-1.5">
                  {connectedEntities.map((c) => {
                    const color = c.type ? TYPE_COLOR[c.type] : undefined;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectNode(c.id)}
                        className="rounded-full border px-2.5 py-1 text-xs font-medium transition hover:brightness-110"
                        style={
                          color
                            ? { backgroundColor: `${color}22`, borderColor: `${color}55`, color }
                            : { borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(255,255,255,0.05)" }
                        }
                      >
                        {c.id} <span className="opacity-70">{c.weight}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <p className="mb-2 text-xs font-medium text-slate-400">
                관련 기사 ({relatedArticles.length}) · 최신순
              </p>
              <div className="space-y-3">
                {shownArticles.map((a) => (
                  <ArticleCard key={a.id} article={a} />
                ))}
                {remainingCount > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setVisibleCount((v) => Math.min(v + RELATED_ARTICLE_PAGE, relatedArticles.length))
                    }
                    className="w-full rounded-xl border border-white/10 bg-white/5 py-2 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:text-white"
                  >
                    더보기 ({shownArticles.length}/{relatedArticles.length})
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}
