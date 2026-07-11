"use client";

// 이슈 히트맵 개발/테스트용 페이지. app/map(UMAP 산점도+밀도)과 별개의 실험으로,
// finviz류 트리맵 히트맵 버전을 실데이터로 확인하기 위한 용도. /map 과 마찬가지로
// 통합 시 ClusterTreemap 컴포넌트만 최종 대시보드로 옮기면 된다.
//
// 날짜 버튼으로 최근 최대 7일치 데이터를 하루씩 골라볼 수 있다 — 지금은 수집 기간이
// 7/8~7/9 이틀뿐이라 버튼도 두 개지만, 수집 기간이 늘어나면 자동으로 최근 7일까지 늘어난다.

import { useMemo, useState } from "react";
import { useArticles } from "../lib/useArticles";
import { computeClusterStats } from "../lib/clusterStats";
import { ClusterTreemap } from "../components/ClusterTreemap";
import { ArticleCard } from "../components/ArticleCard";
import { SentimentPie } from "../components/SentimentPie";

const MAX_DATE_BUTTONS = 7;

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function HeatmapDevPage() {
  const { byId, clusters, loading, error } = useArticles();
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const articles = useMemo(() => Array.from(byId.values()), [byId]);

  // 수집된 기사에 실제로 존재하는 날짜만, 오래된 순으로 최근 7일까지.
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
  // Cluster.size/sentiment_dist는 전체 수집 기간(7/8~7/9) 합산치라 그대로 쓰면 안 맞는다.
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

  return (
    <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <div className="shrink-0 p-4 pb-0">
        <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
          이슈 히트맵
          <span
            title="비슷한 주제의 뉴스끼리 한데 모아서 사각형 하나로 보여주는 지도입니다. 사각형이 클수록 그 주제를 다룬 기사가 많다는 뜻입니다. 사각형을 확대하면 기사 한 건 한 건이 작은 칸으로 나뉘어 보이고, 칸 색깔로 그 기사가 긍정적인지 부정적인지 알 수 있습니다. 사각형이나 칸을 클릭하면 오른쪽에 자세한 내용이 나옵니다. 위쪽 날짜 버튼을 누르면 그날그날 어떤 뉴스가 많았는지 비교해볼 수 있습니다."
            className="cursor-help text-base text-slate-500"
          >
            ⓘ
          </span>
        </h1>

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
        <div className="flex flex-1 items-center justify-center overflow-auto p-8">
          {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {!loading && !error && (
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
            <p className="text-sm leading-6 text-slate-400">
              마우스 스크롤로 화면을 확대·축소할 수 있습니다. 축소된 상태에서는 어떤
              주제의 뉴스가 많은지, 전체적으로 분위기가 어떤지를 사각형 크기와 색으로
              볼 수 있습니다. 확대하면 기사 한 건 한 건의 제목이 보이고, 클릭하면
              오른쪽에서 내용을 읽을 수 있습니다.
            </p>
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
