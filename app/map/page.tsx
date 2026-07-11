"use client";

// 이슈 지도 개발/테스트용 페이지. 메인 챗 UI(app/page.tsx)와는 독립적으로 띄워서
// 줌 threshold·hover·클릭 UX를 실데이터로 조정하기 위한 용도. 통합 시 ClusterMap
// 컴포넌트만 최종 대시보드로 옮기면 된다.

import { useMemo, useState } from "react";
import { useArticles } from "../lib/useArticles";
import { ClusterMap } from "../components/ClusterMap";
import { ArticleCard } from "../components/ArticleCard";
import { SentimentPie } from "../components/SentimentPie";

export default function MapDevPage() {
  const { byId, clusters, loading, error } = useArticles();
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const articles = useMemo(() => Array.from(byId.values()), [byId]);
  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) ?? null;
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
    <main className="flex h-screen w-full flex-col bg-slate-950 text-slate-100">
      <div className="shrink-0 p-4 pb-0">
        <h1 className="flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
          이슈 지도
          <span
            title="비슷한 주제를 다룬 기사끼리 가까이 모이도록 배치한 지도입니다. 화면을 축소하면 주제별로 뭉친 덩어리 모양으로, 확대하면 기사 하나하나가 점으로 보입니다. 덩어리를 클릭하면 그 주제의 요약을, 점을 클릭하면 해당 기사 정보를 볼 수 있습니다."
            className="cursor-help text-base text-slate-500"
          >
            ⓘ
          </span>
        </h1>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex-1 p-4">
          {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}
          {!loading && !error && (
            <ClusterMap
              articles={articles}
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
              덩어리를, 확대한 상태에서는 기사 하나하나를 점으로 클릭할 수 있습니다.
            </p>
          )}

          {selectedCluster && (
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
              <p className="text-xs text-slate-500">기사 {selectedCluster.size}건</p>
              <SentimentPie dist={selectedCluster.sentiment_dist} />
            </div>
          )}

          {selectedArticle && <ArticleCard article={selectedArticle} />}
        </aside>
      </div>
    </main>
  );
}
