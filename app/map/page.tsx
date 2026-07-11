"use client";

// 이슈 지도 개발/테스트용 페이지. 메인 챗 UI(app/page.tsx)와는 독립적으로 띄워서
// 줌 threshold·hover·클릭 UX를 실데이터로 조정하기 위한 용도. 통합 시 ClusterMap
// 컴포넌트만 최종 대시보드로 옮기면 된다.
//
// 날짜 버튼으로 최근 최대 7일치 데이터를 하루씩 골라볼 수 있다 — /heatmap과 동일한
// 패턴. 지도 좌표계(xScale/yScale)는 흔들리지 않도록 ClusterMap에 필터링 전 전체
// 기사(allArticles)도 함께 넘긴다.

import { useMemo, useState } from "react";
import { useArticles } from "../lib/useArticles";
import { computeClusterStats } from "../lib/clusterStats";
import { ClusterMap } from "../components/ClusterMap";
import { ArticleCard } from "../components/ArticleCard";
import { SentimentPie } from "../components/SentimentPie";

const MAX_DATE_BUTTONS = 7;

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export default function MapDevPage() {
  const { byId, clusters, loading, error } = useArticles();
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

  return (
    <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <div className="shrink-0 p-4 pb-0">
        <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
          이슈 지도
          <span
            title="비슷한 주제를 다룬 기사끼리 가까이 모이도록 배치한 지도입니다. 화면을 축소하면 주제별로 뭉친 덩어리 모양이 되고, 그 옆에 무슨 주제인지 말풍선으로 표시됩니다. 확대하면 기사 하나하나가 점으로 보입니다. 덩어리(말풍선)를 클릭하면 그 주제의 요약을, 점을 클릭하면 해당 기사 정보를 볼 수 있습니다. 위쪽 날짜 버튼으로 하루씩 골라보며 변화 추이를 볼 수 있습니다."
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
        <div className="flex-1 p-4">
          {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {!loading && !error && (
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
        </div>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-white/10 p-4">
          {!selectedCluster && !selectedArticle && (
            <p className="text-sm leading-6 text-slate-400">
              지도를 스크롤해서 확대/축소해보세요. 축소된 상태에서는 비슷한 주제끼리 뭉친
              덩어리와 말풍선 라벨을, 확대한 상태에서는 기사 하나하나를 점으로 클릭할 수
              있습니다.
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
