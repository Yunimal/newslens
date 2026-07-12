"use client";

// 가영님이 만든 시각화 컴포넌트 5종(ClusterMap·TrendChart·EntityGraph·SentimentPie·ArticleCard)을
// 하나의 대시보드로 묶는 통합 페이지. 데이터는 기존 useArticles(/api/articles)·useGraph(/api/graph)
// 훅을 그대로 재사용한다 — 두 라우트 모두 서버 전용 embeddings를 포함하지 않으므로
// 클라이언트로 임베딩이 새지 않는다. 컴포넌트 자체는 수정하지 않고 props로만 연결한다.

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Article, Sentiment } from "@/types/schema";
import { useArticles } from "../lib/useArticles";
import { useGraph } from "../lib/useGraph";
import { computeClusterStats } from "../lib/clusterStats";
import { ClusterMap } from "../components/ClusterMap";
import { SentimentPie } from "../components/SentimentPie";
import { TrendChart } from "../components/TrendChart";
import { EntityGraph, TYPE_LABEL } from "../components/EntityGraph";
import { ArticleCard } from "../components/ArticleCard";

type Tab = "map" | "trends" | "graph";

const TABS: { id: Tab; label: string }[] = [
  { id: "map", label: "이슈 지도" },
  { id: "trends", label: "키워드 트렌드" },
  { id: "graph", label: "관계망" },
];

function periodLabel(articles: Article[]): string {
  if (articles.length === 0) return "-";
  let min = articles[0].published_at;
  let max = articles[0].published_at;
  for (const a of articles) {
    if (a.published_at < min) min = a.published_at;
    if (a.published_at > max) max = a.published_at;
  }
  return min === max ? min : `${min} ~ ${max}`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <span className="text-2xl font-semibold tracking-tight text-white">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const { byId, clusters, trends, loading, error } = useArticles();
  const [tab, setTab] = useState<Tab>("map");

  const articles = useMemo(() => Array.from(byId.values()), [byId]);

  // 이슈 지도 탭 선택 상태 — 클러스터를 고르면 사이드 감성 도넛도 그 클러스터 기준으로 바뀐다.
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const statsByCluster = useMemo(() => computeClusterStats(articles), [articles]);

  // 사이드 감성 도넛: 클러스터 미선택 시 전체 기사 기준, 선택 시 해당 클러스터 기준.
  const overallDist = useMemo(() => {
    const d: Record<Sentiment, number> = { pos: 0, neu: 0, neg: 0 };
    for (const a of articles) d[a.sentiment] += 1;
    return d;
  }, [articles]);

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null;
  const sideDist = selectedCluster
    ? statsByCluster.get(selectedCluster.id)?.sentiment_dist ?? { pos: 0, neu: 0, neg: 0 }
    : overallDist;
  const selectedArticle = selectedArticleId ? byId.get(selectedArticleId) ?? null : null;

  function selectCluster(id: number) {
    setSelectedClusterId(id);
    setSelectedArticleId(null);
  }
  function selectArticle(id: string) {
    setSelectedArticleId(id);
    setSelectedClusterId(null);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col bg-slate-950 px-4 text-slate-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/10 bg-slate-950/80 py-4 backdrop-blur">
        <span className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-sm font-medium text-cyan-200">
          NewsLens
        </span>
        <p className="hidden text-sm text-slate-400 sm:block">뉴스 이슈 대시보드</p>
        <Link
          href="/"
          className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-slate-200 transition hover:border-cyan-300/50 hover:bg-cyan-300/10"
        >
          💬 AI 리서처에게 질문
        </Link>
      </header>

      {loading && <p className="py-10 text-sm text-slate-400">불러오는 중...</p>}
      {error && <p className="py-10 text-sm text-rose-300">{error}</p>}

      {!loading && !error && (
        <div className="flex-1 space-y-5 py-6">
          {/* 통계 카드 */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard label="수집 기사 수" value={`${articles.length.toLocaleString()}건`} />
            <StatCard label="수집 기간" value={periodLabel(articles)} />
            <StatCard label="이슈 클러스터 수" value={`${clusters.length}개`} />
          </section>

          {/* 탭 */}
          <div className="flex items-center gap-1 rounded-full bg-white/5 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  tab === t.id ? "bg-cyan-300 text-slate-900" : "text-slate-300 hover:bg-white/10"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 이슈 지도 탭: 지도 + 사이드(감성 도넛 / 선택 기사) */}
          {tab === "map" && (
            <section className="flex flex-col gap-4 lg:flex-row">
              <div className="h-[70vh] min-h-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.02] p-2">
                <ClusterMap
                  articles={articles}
                  allArticles={articles}
                  clusters={clusters}
                  selectedClusterId={selectedClusterId}
                  selectedArticleId={selectedArticleId}
                  onSelectCluster={selectCluster}
                  onSelectArticle={selectArticle}
                />
              </div>

              <aside className="w-full shrink-0 space-y-4 lg:w-80">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="mb-3 text-sm font-medium text-slate-200">
                    {selectedCluster ? `${selectedCluster.label} · 논조` : "전체 논조 분포"}
                  </p>
                  <SentimentPie dist={sideDist} />
                </div>
                {selectedArticle && <ArticleCard article={selectedArticle} />}
                {!selectedArticle && !selectedCluster && (
                  <p className="px-1 text-xs leading-6 text-slate-500">
                    지도의 덩어리(클러스터)나 점(기사)을 클릭하면 여기에 논조 분포와 기사 정보가
                    표시됩니다.
                  </p>
                )}
              </aside>
            </section>
          )}

          {/* 키워드 트렌드 탭 */}
          {tab === "trends" && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <TrendChart trends={trends} articles={articles} />
            </section>
          )}

          {/* 관계망 탭 */}
          {tab === "graph" && <GraphTab byId={byId} />}
        </div>
      )}
    </main>
  );
}

// 관계망 탭은 useGraph(/api/graph)를 쓰므로, 탭이 실제로 열릴 때만 마운트되도록 분리한다
// (지도/트렌드만 볼 사용자는 graph.json을 받지 않는다).
function GraphTab({ byId }: { byId: Map<string, Article> }) {
  const { nodes, edges, loading, error } = useGraph();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const relatedArticles = useMemo(() => {
    if (!selectedNode) return [];
    return selectedNode.article_ids
      .map((id) => byId.get(id))
      .filter((a): a is Article => Boolean(a))
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .slice(0, 8);
  }, [selectedNode, byId]);

  return (
    <section className="flex flex-col gap-4 lg:flex-row">
      <div className="h-[70vh] min-h-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.02] p-2">
        {loading && <p className="p-4 text-sm text-slate-400">관계망 불러오는 중...</p>}
        {error && <p className="p-4 text-sm text-rose-300">{error}</p>}
        {!loading && !error && (
          <EntityGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        )}
      </div>

      <aside className="w-full shrink-0 space-y-3 lg:w-80">
        {!selectedNode && (
          <p className="px-1 text-xs leading-6 text-slate-500">
            노드(인물·기관·지역)를 클릭하면 관련 기사가 여기에 표시됩니다.
          </p>
        )}
        {selectedNode && (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h2 className="text-lg font-semibold text-white">{selectedNode.id}</h2>
              <p className="text-xs text-slate-500">
                {TYPE_LABEL[selectedNode.type]} · {selectedNode.count}건
              </p>
            </div>
            {relatedArticles.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </>
        )}
      </aside>
    </section>
  );
}
