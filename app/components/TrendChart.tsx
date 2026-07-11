"use client";

// 키워드 트렌드 시계열. trends[]는 키워드별로 독립된 series(날짜별 count)를 갖는데,
// recharts LineChart는 "행 = 날짜, 열 = 키워드"로 피벗된 하나의 배열을 기대하므로 변환한다.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import * as d3 from "d3";
import type { Article, Trend } from "@/types/schema";

const MAX_SELECTED = 8;
const DEFAULT_SELECTED_COUNT = 4;
const REPRESENTATIVE_COUNT = 3;
// "트렌드"는 최근 흐름을 보는 것이지 전체 이력이 아니다 — 데이터가 몇 달치로 쌓여도
// X축이 안 빽빽해지도록 최근 N일만 보여준다. 수집 기간이 이보다 짧으면 있는 만큼만 나온다.
const TREND_WINDOW_DAYS = 7;

type HoverInfo = {
  label: string;
  items: { key: string; value: number; color: string }[];
} | null;

// recharts의 기본 Tooltip은 차트 내부·마우스 근처에만 그릴 수 있어서, 마우스를 따라다니며
// 계속 위치가 바뀐다. 고정된 자리(차트 옆 패널)에 표시하기 위해 content를 훅 삼아 호버
// 데이터만 상위 상태로 끌어올리고(return null, 자기 자신은 아무것도 안 그림), 실제 렌더는
// 부모가 레이아웃 안의 고정된 자리(사이드 패널)에서 담당한다.
function TooltipSync({
  active,
  payload,
  label,
  onChange,
}: {
  active?: boolean;
  payload?: { dataKey?: string; value?: number; color?: string }[];
  label?: string;
  onChange: (info: HoverInfo) => void;
}) {
  // recharts는 호버 값이 그대로여도 payload를 매번 새 배열로 만들어 넘긴다. deps 배열이
  // 그 참조만 보면 "값이 같아도 바뀐 것"으로 오인해 onChange → 상위 리렌더 → 새 payload →
  // 다시 effect 실행이 무한 반복된다(Maximum update depth exceeded). 그래서 매 렌더마다
  // 실행하되, 직렬화한 값으로 실제 내용이 바뀌었을 때만 onChange를 호출해 끊는다.
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const hasData = Boolean(active && payload && payload.length);
    const key = hasData
      ? `${label}|${payload!.map((p) => `${p.dataKey}:${p.value}`).join(",")}`
      : null;

    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;

    onChange(
      hasData
        ? {
            label: String(label),
            items: payload!.map((p) => ({
              key: String(p.dataKey),
              value: Number(p.value),
              color: p.color ?? "#fff",
            })),
          }
        : null,
    );
  });
  return null;
}

// 색은 "전체 20개 키워드 중 몇 번째냐"가 아니라 "지금 선택된 것들 중 몇 번째냐"로 정한다.
// 전체 기준으로 정하면 팔레트가 10색이라 20개 키워드에서 mod로 겹치는 조합이 생기지만,
// 선택 가능 개수(MAX_SELECTED=8)가 팔레트보다 작으므로 이 방식은 항상 겹치지 않는다.
function keywordColor(keyword: string, orderedSelected: string[]): string {
  const idx = orderedSelected.indexOf(keyword);
  return d3.schemeTableau10[idx % d3.schemeTableau10.length];
}

// { keyword, series: [{date,count}] }[] → [{ date, [keyword]: count, ... }]
// 날짜 윈도우는 선택된 키워드가 아니라 전체 trends 기준으로 정한다 — 어떤 키워드를
// 토글하든 항상 같은 최근 N일이 보여야 하고(선택 바뀔 때마다 축이 흔들리면 안 됨),
// 스키마상 모든 키워드의 series가 동일한 날짜 범위를 공유하므로 결과는 같다.
function pivot(trends: Trend[], selected: Set<string>) {
  const dates = new Set<string>();
  for (const t of trends) {
    for (const p of t.series) dates.add(p.date);
  }
  const recentDates = Array.from(dates).sort().slice(-TREND_WINDOW_DAYS);

  return recentDates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const t of trends) {
      if (!selected.has(t.keyword)) continue;
      row[t.keyword] = t.series.find((p) => p.date === date)?.count ?? 0;
    }
    return row;
  });
}

export function TrendChart({ trends, articles }: { trends: Trend[]; articles: Article[] }) {
  const allKeywords = useMemo(() => trends.map((t) => t.keyword), [trends]);

  const [selected, setSelected] = useState<Set<string>>(() => {
    const byTotal = [...trends].sort((a, b) => sum(b.series) - sum(a.series));
    return new Set(byTotal.slice(0, DEFAULT_SELECTED_COUNT).map((t) => t.keyword));
  });
  const [focusedKeyword, setFocusedKeyword] = useState<string | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo>(null);

  const data = useMemo(() => pivot(trends, selected), [trends, selected]);
  // Set은 삽입 순서를 보존하므로 이 배열이 곧 "선택된 순서" — 색상 인덱스의 기준.
  const selectedOrder = useMemo(() => Array.from(selected), [selected]);

  const representativeArticles = useMemo(() => {
    if (!focusedKeyword) return [];
    return articles
      .filter((a) => a.keywords.includes(focusedKeyword))
      .sort((a, b) => b.published_at.localeCompare(a.published_at))
      .slice(0, REPRESENTATIVE_COUNT);
  }, [articles, focusedKeyword]);

  function toggle(keyword: string) {
    setFocusedKeyword(keyword);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) {
        next.delete(keyword);
      } else if (next.size < MAX_SELECTED) {
        next.add(keyword);
      }
      return next;
    });
  }

  if (trends.length === 0) {
    return <p className="text-sm text-slate-400">트렌드 데이터가 없습니다.</p>;
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/60 p-5">
      <div className="flex flex-wrap gap-2.5">
        {allKeywords.map((kw) => {
          const active = selected.has(kw);
          return (
            <button
              key={kw}
              type="button"
              onClick={() => toggle(kw)}
              disabled={!active && selected.size >= MAX_SELECTED}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? "border-transparent text-slate-950"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
              } ${focusedKeyword === kw ? "ring-2 ring-white/60" : ""}`}
              style={active ? { backgroundColor: keywordColor(kw, selectedOrder) } : undefined}
            >
              {kw}
            </button>
          );
        })}
      </div>

      {/* 차트 + 호버 패널을 나란히 — 패널을 화면에 띄우는 대신 레이아웃 안에 고정 자리로 정박시킨다 */}
      <div className="flex h-80 gap-4">
        <div className="min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.4)" fontSize={13} />
              <YAxis stroke="rgba(255,255,255,0.4)" fontSize={13} allowDecimals={false} />
              <Tooltip
                content={<TooltipSync onChange={setHoverInfo} />}
                cursor={{ stroke: "rgba(255,255,255,0.25)" }}
              />
              {selectedOrder.map((kw) => (
                <Line
                  key={kw}
                  type="monotone"
                  dataKey={kw}
                  stroke={keywordColor(kw, selectedOrder)}
                  strokeWidth={2.5}
                  dot={{ r: 3.5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="w-72 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          {hoverInfo ? (
            <>
              <p className="mb-1.5 text-sm font-semibold text-white">{hoverInfo.label}</p>
              <div className="space-y-1">
                {hoverInfo.items.map((it) => (
                  <p key={it.key} className="text-sm font-medium" style={{ color: it.color }}>
                    {it.key} : {it.value}
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="flex h-full items-center text-sm text-slate-500">
              그래프에 마우스를 올리면 값이 여기 표시됩니다.
            </p>
          )}
        </div>
      </div>

      {focusedKeyword && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className="mb-3 text-base font-medium text-slate-200">
            &ldquo;{focusedKeyword}&rdquo; 대표 기사
          </p>
          {representativeArticles.length === 0 ? (
            <p className="text-sm text-slate-500">관련 기사를 찾지 못했습니다.</p>
          ) : (
            <ul className="space-y-2.5">
              {representativeArticles.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-cyan-300 hover:text-cyan-200 hover:underline"
                  >
                    {a.title}
                  </a>
                  <span className="shrink-0 text-xs text-slate-500">
                    {a.press} · {a.published_at}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function sum(series: { count: number }[]): number {
  return series.reduce((acc, p) => acc + p.count, 0);
}
