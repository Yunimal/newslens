"use client";

// 인물·기관 관계망. d3-force로 레이아웃을 계산해 "정적으로" 자리를 잡은 뒤(계속 움직이는
// 물리 시뮬레이션이 아니라 300틱 미리 돌려서 안정된 좌표만 사용) SVG로 그린다 — 60개
// 노드 규모에서는 이 편이 매 프레임 리렌더보다 훨씬 단순하고 가볍다.
// pan/zoom은 ClusterMap과 동일하게 d3-zoom.
//
// 검색·타입 필터·상위 N개 보기·줌 툴바는 이 컴포넌트가 자기 상태로 들고 있다 — 전부
// "그래프를 어떻게 보여줄지"에 대한 관심사라 부모(페이지)에 끌어올릴 이유가 없다.
// 부모는 선택된 노드에 반응(기사 패널 렌더링)하는 것만 신경 쓴다.

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { EntityType, GraphEdge, GraphNode } from "@/types/schema";

const VIEW_W = 900;
const VIEW_H = 700;
const NODE_MIN_R = 6;
const NODE_MAX_R = 22;
const EDGE_MIN_W = 1;
const EDGE_MAX_W = 4;
const ALWAYS_LABEL_COUNT = 10; // count 기준 상위 N개는 항상 라벨 표시, 나머지는 hover 시에만
const TOP_N_OPTION = 30;
const ZOOM_STEP = 1.3;

export const TYPE_COLOR: Record<EntityType, string> = {
  ORG: "#4e79a7",
  PER: "#f28e2b",
  LOC: "#59a14f",
};
// 사용자에게는 원본 코드(PER/ORG/LOC) 대신 이 라벨만 노출한다.
export const TYPE_LABEL: Record<EntityType, string> = {
  PER: "인물",
  ORG: "기관",
  LOC: "지역",
};

interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  weight: number;
  article_ids: string[];
}

export function EntityGraph({
  nodes,
  edges,
  selectedNodeId = null,
  onSelectNode,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<EntityType | "ALL">("ALL");
  const [topN, setTopN] = useState<number | null>(TOP_N_OPTION);

  // 크기·굵기 스케일은 항상 "전체" 노드/엣지 기준으로 고정한다 — 필터링해서 보이는 개수가
  // 달라져도 같은 count는 항상 같은 크기로 보여야 비교가 왜곡되지 않는다.
  const nodeRadius = useMemo(() => {
    const maxCount = Math.max(...nodes.map((n) => n.count), 1);
    return d3.scaleSqrt().domain([0, maxCount]).range([NODE_MIN_R, NODE_MAX_R]).clamp(true);
  }, [nodes]);

  const edgeWidth = useMemo(() => {
    const weights = edges.map((e) => e.weight);
    const domain: [number, number] = [Math.min(...weights, 1), Math.max(...weights, 1)];
    return d3.scaleLinear().domain(domain).range([EDGE_MIN_W, EDGE_MAX_W]).clamp(true);
  }, [edges]);

  // 타입 필터 → 상위 N개 순으로 적용해 실제로 시뮬레이션·렌더링할 노드 집합을 줄인다.
  const visibleNodes = useMemo(() => {
    let list = typeFilter === "ALL" ? nodes : nodes.filter((n) => n.type === typeFilter);
    if (topN != null) {
      list = [...list].sort((a, b) => b.count - a.count).slice(0, topN);
    }
    return list;
  }, [nodes, typeFilter, topN]);

  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [edges, visibleNodes]);

  const labelThreshold = useMemo(() => {
    const sorted = visibleNodes.map((n) => n.count).sort((a, b) => b - a);
    return sorted[Math.min(ALWAYS_LABEL_COUNT - 1, sorted.length - 1)] ?? 0;
  }, [visibleNodes]);

  // d3-force로 좌표를 한 번만 계산 — 필터가 바뀌면(=보이는 노드 집합이 바뀌면) 다시 계산한다.
  const { simNodes, simLinks } = useMemo(() => {
    const ns: SimNode[] = visibleNodes.map((n) => ({ ...n }));
    const ls: SimLink[] = visibleEdges.map((e) => ({ ...e }));
    const sim = d3
      .forceSimulation(ns)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(ls)
          .id((d) => d.id)
          .distance(60)
          .strength(0.25),
      )
      .force("charge", d3.forceManyBody().strength(-140))
      .force("center", d3.forceCenter(VIEW_W / 2, VIEW_H / 2))
      .force(
        "collide",
        d3.forceCollide<SimNode>((d) => nodeRadius(d.count) + 6),
      )
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    return { simNodes: ns, simLinks: ls };
  }, [visibleNodes, visibleEdges, nodeRadius]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 8])
      .on("zoom", (event) => setTransform(event.transform));
    zoomBehaviorRef.current = zoom;
    d3.select(svg).call(zoom);
    return () => {
      d3.select(svg).on(".zoom", null);
    };
  }, []);

  function zoomBy(factor: number) {
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!svg || !zoom) return;
    d3.select(svg).transition().duration(200).call(zoom.scaleBy, factor);
  }

  function resetView() {
    const svg = svgRef.current;
    const zoom = zoomBehaviorRef.current;
    if (!svg || !zoom) return;
    d3.select(svg).transition().duration(300).call(zoom.transform, d3.zoomIdentity);
  }

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query.length > 0;
  const matchedIds = useMemo(() => {
    if (!isSearching) return null;
    return new Set(visibleNodes.filter((n) => n.id.toLowerCase().includes(query)).map((n) => n.id));
  }, [isSearching, query, visibleNodes]);

  const activeId = hoveredNodeId ?? selectedNodeId;

  const connectedIds = useMemo(() => {
    if (!activeId) return null;
    const set = new Set<string>([activeId]);
    for (const l of simLinks) {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      if (s === activeId) set.add(t);
      if (t === activeId) set.add(s);
    }
    return set;
  }, [activeId, simLinks]);

  return (
    <div className="flex h-full w-full flex-col gap-3">
      {/* 상위 N개 / 전체 보기(좌) + 검색 · 타입 필터(우) — 한 줄에, 버튼 크기도 통일 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setTopN(TOP_N_OPTION)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              topN != null
                ? "border-transparent bg-white/15 text-white"
                : "border-white/10 bg-transparent text-slate-400 hover:border-white/20"
            }`}
          >
            상위 {TOP_N_OPTION}개 보기
          </button>
          <button
            type="button"
            onClick={() => setTopN(null)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              topN == null
                ? "border-transparent bg-white/15 text-white"
                : "border-white/10 bg-transparent text-slate-400 hover:border-white/20"
            }`}
          >
            전체 보기 ({nodes.length}개)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="이름으로 검색..."
              className="w-56 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/50"
            />
            {isSearching && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="검색어 지우기"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex gap-1.5">
            {(["ALL", "PER", "ORG", "LOC"] as const).map((t) => {
              const isActive = typeFilter === t;
              const color = t === "ALL" ? null : TYPE_COLOR[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    color
                      ? "" // 타입별 색은 style로 직접 지정(팔레트가 클래스로 매핑 안 되므로)
                      : isActive
                        ? "border-transparent bg-cyan-300 text-slate-950"
                        : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"
                  }`}
                  style={
                    color
                      ? isActive
                        ? { backgroundColor: color, borderColor: color, color: "#0f172a" }
                        : { backgroundColor: `${color}22`, borderColor: `${color}55`, color }
                      : undefined
                  }
                >
                  {t === "ALL" ? "전체" : TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-full w-full touch-none"
        >
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {simLinks.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (typeof s !== "object" || typeof t !== "object") return null;
              const isConnected = activeId ? s.id === activeId || t.id === activeId : false;
              return (
                <line
                  key={i}
                  x1={s.x}
                  y1={s.y}
                  x2={t.x}
                  y2={t.y}
                  stroke={isConnected ? "#ffffff" : "rgba(255,255,255,0.2)"}
                  strokeWidth={edgeWidth(l.weight) / transform.k}
                  strokeOpacity={isSearching ? 0.1 : activeId ? (isConnected ? 0.9 : 0.15) : 0.5}
                />
              );
            })}

            {simNodes.map((n) => {
              const isActive = n.id === activeId;
              const isDimmed = isSearching
                ? !matchedIds?.has(n.id)
                : activeId !== null && !connectedIds?.has(n.id);
              const showLabel = isActive || n.count >= labelThreshold;
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={isDimmed ? 0.4 : 1}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((v) => (v === n.id ? null : v))}
                  onClick={() => onSelectNode(n.id)}
                  className="cursor-pointer"
                >
                  <circle
                    r={nodeRadius(n.count)}
                    fill={TYPE_COLOR[n.type]}
                    stroke={isActive ? "white" : "none"}
                    strokeWidth={isActive ? 2 / transform.k : 0}
                  />
                  {showLabel && (
                    <text
                      x={nodeRadius(n.count) + 4}
                      y={4}
                      fontSize={11 / transform.k}
                      fill="#e2e8f0"
                      className="select-none"
                    >
                      {n.id}
                    </text>
                  )}
                  <title>{`${n.id} (${TYPE_LABEL[n.type]}) · ${n.count}건`}</title>
                </g>
              );
            })}
          </g>
        </svg>

        {/* 범례 */}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/90 p-3 text-xs text-slate-300 backdrop-blur">
          {(["PER", "ORG", "LOC"] as const).map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: TYPE_COLOR[t] }}
              />
              {TYPE_LABEL[t]}
            </span>
          ))}
        </div>

        {/* 줌 툴바 */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-white/10 bg-slate-900/90 px-2 py-1.5 backdrop-blur">
          <button
            type="button"
            onClick={resetView}
            className="rounded-full px-2 py-1 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            전체 보기
          </button>
          <div className="mx-1 h-4 w-px bg-white/10" />
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            aria-label="축소"
            className="rounded-full px-2 py-1 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            −
          </button>
          <span className="w-11 text-center text-xs text-slate-400">
            {Math.round(transform.k * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            aria-label="확대"
            className="rounded-full px-2 py-1 text-sm text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
