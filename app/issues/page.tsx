"use client";

// 이슈 지도(ClusterMap)와 이슈 히트맵(ClusterTreemap)을 한 화면에서 오른쪽 위 버튼으로
// 전환하며 볼 수 있는 통합 개발/테스트 페이지. 각 화면 자체의 기능(날짜별 보기,
// 확대/축소, 클릭 상호작용, 생김새)은 /map, /heatmap과 완전히 동일하다 — 여기서는
// 그 둘을 감싸고 위쪽에 전환 버튼만 얹는다. 날짜·선택 상태는 두 화면이 공유해서,
// 전환해도 보던 클러스터/기사가 그대로 유지된다.

import { useMemo, useState } from "react";
import { useArticles } from "../lib/useArticles";
import { computeClusterStats } from "../lib/clusterStats";
import { ClusterMap } from "../components/ClusterMap";
import { ClusterTreemap } from "../components/ClusterTreemap";
import { ArticleCard } from "../components/ArticleCard";
import { SentimentPie } from "../components/SentimentPie";

const MAX_DATE_BUTTONS = 7;

type View = "map" | "heatmap";

const VIEW_META: Record<View, { label: string; title: string; tooltip: string; defaultHint: string }> = {
  map: {
    label: "이슈 지도",
    title: "이슈 지도",
    tooltip:
      "비슷한 주제를 다룬 기사끼리 가까이 모이도록 배치한 지도입니다. 화면을 축소하면 주제별로 뭉친 덩어리 모양이 되고, 그 옆에 무슨 주제인지 말풍선으로 표시됩니다. 확대하면 기사 하나하나가 점으로 보입니다. 덩어리(말풍선)를 클릭하면 그 주제의 요약을, 점을 클릭하면 해당 기사 정보를 볼 수 있습니다. 위쪽 날짜 버튼으로 하루씩 골라보며 변화 추이를 볼 수 있습니다.",
    defaultHint:
      "지도를 스크롤해서 확대/축소해보세요. 축소된 상태에서는 비슷한 주제끼리 뭉친 덩어리와 말풍선 라벨을, 확대한 상태에서는 기사 하나하나를 점으로 클릭할 수 있습니다.",
  },
  heatmap: {
    label: "히트맵",
    title: "이슈 히트맵",
    tooltip:
      "비슷한 주제의 뉴스끼리 한데 모아서 사각형 하나로 보여주는 지도입니다. 사각형이 클수록 그 주제를 다룬 기사가 많다는 뜻입니다. 사각형을 확대하면 기사 한 건 한 건이 작은 칸으로 나뉘어 보이고, 칸 색깔로 그 기사가 긍정적인지 부정적인지 알 수 있습니다. 사각형이나 칸을 클릭하면 오른쪽에 자세한 내용이 나옵니다. 위쪽 날짜 버튼을 누르면 그날그날 어떤 뉴스가 많았는지 비교해볼 수 있습니다.",
    defaultHint:
      "마우스 스크롤로 화면을 확대·축소할 수 있습니다. 축소된 상태에서는 어떤 주제의 뉴스가 많은지, 전체적으로 분위기가 어떤지를 사각형 크기와 색으로 볼 수 있습니다. 확대하면 기사 한 건 한 건의 제목이 보이고, 클릭하면 오른쪽에서 내용을 읽을 수 있습니다.",
  },
};

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function IssuesPage() {
  const { byId, clusters, loading, error } = useArticles();
  const [view, setView] = useState<View>("map");
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const articles = useMemo(() => Array.from(byId.values()), [byId]);

  const dates = useMemo(() => {
    const uniq = Array.from(new Set(articles.map((a) => a.published_at))).sort();
    return uniq.slice(-MAX_DATE_BUTTONS);
  }, [articles]);

  const activeDate = selectedDate ?? dates[dates.length - 1] ?? null;
  const dailyArticles = useMemo(
    () => (activeDate ? articles.filter((a) => a.published_at === activeDate) : articles),
    [articles, activeDate],
  );
  // 사이드바의 "기사 N건"·논조 분포도 선택된 날짜 기준으로 다시 집계한다 —
  // Cluster.size/sentiment_dist는 전체 수집 기간 합산치라 그대로 쓰면 안 맞는다.
  const dailyClusterStats = useMemo(() => computeClusterStats(dailyArticles), [dailyArticles]);

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null;
  const selectedClusterStats = selectedCluster
    ? dailyClusterStats.get(selectedCluster.id) ?? { size: 0, sentiment_dist: { pos: 0, neu: 0, neg: 0 } }
    : null;
  const selectedArticle = selectedArticleId ? byId.get(selectedArticleId) ?? null : null;

  function selectDate(d: string) {
    setSelectedDate(d);
    setSelectedClusterId(null);
    setSelectedArticleId(null);
  }
  function selectCluster(id: number) {
    setSelectedClusterId(id);
    setSelectedArticleId(null);
  }
  function selectArticle(id: string) {
    setSelectedArticleId(id);
    setSelectedClusterId(null);
  }

  const meta = VIEW_META[view];

  return (
    <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <div className="shrink-0 p-4 pb-0">
        <div className="flex items-start justify-between gap-4">
          <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
            {meta.title}
            <span title={meta.tooltip} className="cursor-help text-base text-slate-500">
              ⓘ
            </span>
          </h1>

          <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/5 p-1">
            {(Object.keys(VIEW_META) as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  view === v ? "bg-cyan-300 text-slate-900" : "text-slate-300 hover:bg-white/10"
                }`}
              >
                {VIEW_META[v].label}
              </button>
            ))}
          </div>
        </div>

        {dates.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5">
            {dates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => selectDate(d)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  d === activeDate
                    ? "bg-cyan-300 text-slate-900"
                    : "bg-white/5 text-slate-300 hover:bg-white/10"
                }`}
              >
                {formatShortDate(d)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={
            view === "map" ? "flex-1 p-4" : "flex flex-1 items-center justify-center overflow-auto p-8"
          }
        >
          {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}

          {!loading && !error && view === "map" && (
            <ClusterMap
              articles={dailyArticles}
              allArticles={articles}
              clusters={clusters}
              selectedClusterId={selectedClusterId}
              selectedArticleId={selectedArticleId}
              onSelectCluster={selectCluster}
              onSelectArticle={selectArticle}
            />
          )}

          {!loading && !error && view === "heatmap" && (
            <div className="aspect-[10/7] h-full max-h-[640px] w-full max-w-4xl">
              <ClusterTreemap
                articles={dailyArticles}
                clusters={clusters}
                selectedClusterId={selectedClusterId}
                selectedArticleId={selectedArticleId}
                onSelectCluster={selectCluster}
                onSelectArticle={selectArticle}
              />
            </div>
          )}
        </div>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-white/10 p-4">
          {!selectedCluster && !selectedArticle && (
            <p className="text-sm leading-6 text-slate-400">{meta.defaultHint}</p>
          )}

          {selectedCluster && selectedClusterStats && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-white">{selectedCluster.label}</h2>
              <p className="text-sm leading-6 text-slate-300">{selectedCluster.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedCluster.keywords.map((kw) => (
                  <span
                    key={kw}
                    className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300"
                  >
                    #{kw}
                  </span>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {activeDate} · 기사 {selectedClusterStats.size}건
              </p>
              <SentimentPie dist={selectedClusterStats.sentiment_dist} />
            </div>
          )}

          {selectedArticle && <ArticleCard article={selectedArticle} />}
        </aside>
      </div>
    </main>
  );
}
