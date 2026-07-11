"use client";

// 키워드 트렌드 개발/테스트용 페이지. /map과 동일한 목적 — 메인 챗 UI와 독립적으로
// 실데이터 렌더링을 확인하기 위한 용도.

import { useMemo } from "react";
import { useArticles } from "../lib/useArticles";
import { TrendChart } from "../components/TrendChart";

export default function TrendsDevPage() {
  const { byId, trends, loading, error } = useArticles();
  const articles = useMemo(() => Array.from(byId.values()), [byId]);

  return (
    <main className="flex min-h-screen w-full flex-col bg-slate-950 p-6 text-slate-100">
      <h1 className="mb-4 flex items-center gap-1.5 text-3xl font-semibold tracking-tight text-white">
        키워드 트렌드
        <span
          title="최근 일주일치 키워드 트렌드입니다. 선택한 키워드들이 날짜별로 몇 건씩 등장했는지 보여줍니다. 차트에 마우스를 올리면 값이 오른쪽 패널에 표시되고, 키워드를 클릭하면 대표 기사가 아래에 나타납니다."
          className="cursor-help text-base text-slate-500"
        >
          ⓘ
        </span>
      </h1>
      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {!loading && !error && <TrendChart trends={trends} articles={articles} />}
    </main>
  );
}
