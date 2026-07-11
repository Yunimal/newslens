"use client";

// 논조(긍정/중립/부정) 분포 원그래프. 색은 ArticleCard의 논조 배지(에메랄드/슬레이트/로즈)와
// 맞춰서, 카드에서 보던 색과 여기서 보는 색이 같은 의미로 읽히게 한다.

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { Sentiment } from "@/types/schema";

const SENTIMENT_COLOR: Record<Sentiment, string> = {
  pos: "#34d399", // emerald-400
  neu: "#94a3b8", // slate-400
  neg: "#fb7185", // rose-400
};
const SENTIMENT_LABEL: Record<Sentiment, string> = {
  pos: "긍정",
  neu: "중립",
  neg: "부정",
};
const ORDER: Sentiment[] = ["pos", "neu", "neg"];

export function SentimentPie({ dist }: { dist: Record<Sentiment, number> }) {
  const total = dist.pos + dist.neu + dist.neg;
  // 0건인 조각은 파이에서 빼야 한다 — 안 그러면 폭 0짜리 조각이 라벨/렌더링을 깨뜨린다.
  const data = ORDER.map((k) => ({ key: k, value: dist[k] })).filter((d) => d.value > 0);

  if (total === 0) {
    return <p className="text-xs text-slate-500">논조 데이터가 없습니다.</p>;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="h-20 w-20 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="key"
              innerRadius={22}
              outerRadius={38}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.key} fill={SENTIMENT_COLOR[d.key]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1">
        {ORDER.map((k) => (
          <p key={k} className="flex items-center gap-1.5 text-xs" style={{ color: SENTIMENT_COLOR[k] }}>
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: SENTIMENT_COLOR[k] }}
            />
            {SENTIMENT_LABEL[k]} {dist[k]}건 · {Math.round((dist[k] / total) * 100)}%
          </p>
        ))}
      </div>
    </div>
  );
}
