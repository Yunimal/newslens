"use client";

// 이슈 히트맵 — finviz류 트리맵. 주제(클러스터)별로 큰 영역을 나누고, 그 안에
// 기사 한 건당 셀 하나(=논조 색)로 채운다.
//
// ClusterMap(UMAP 산점도)처럼 줌 레벨에 따라 렌더 모드를 나눈다:
//  - "cluster" 모드(축소): 클러스터 하나당 타일 하나. 타일 색은 clusterColor(카테고리
//    팔레트)로 클러스터마다 확실히 다른 색을 줘서 주제 구분이 한눈에 되게 하고,
//    타일 크기로 기사량(volume) 차이가 한눈에 보이도록 세부 정보를 일부러 감춘다.
//  - "article" 모드(확대): 클러스터 영역 상단에 헤더 띠(주제명·건수)를 두고, 그 아래를
//    기사 한 건당 칸 하나(논조 색)로 채운 상세 보기. 여기서만 기사 제목이 보인다.

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Article, Cluster, Sentiment } from "@/types/schema";
import { computeClusterStats, type ClusterStats } from "../lib/clusterStats";
import { clusterColor } from "../lib/clusterColors";

const EMPTY_STATS: ClusterStats = { size: 0, sentiment_dist: { pos: 0, neu: 0, neg: 0 } };

const VIEW_W = 1000;
const VIEW_H = 700;
const HEADER_H = 20; // 클러스터 헤더 띠 높이(데이터 좌표계 기준, article 모드 전용)

// k가 이 값 미만이면 클러스터 타일 개요, 이상이면 기사 단위 상세 — ClusterMap의
// HEATMAP_ZOOM_THRESHOLD와 같은 역할이지만 의미가 반대(여긴 기본이 "축소=개요").
const ARTICLE_ZOOM_THRESHOLD = 1.8;

// SentimentPie·ArticleCard와 같은 팔레트 — 앱 전체에서 "논조 색"의 의미가 통일되게.
// neu는 원래 slate-500(#64748b)이었으나 기사 칸이 빽빽할 때 너무 어두워 보여
// SentimentPie와 동일한 slate-400으로 맞췄다.
const SENTIMENT_COLOR: Record<Sentiment, string> = {
  pos: "#34d399",
  neu: "#94a3b8",
  neg: "#fb7185",
};

// 화면(픽셀) 기준 — 이 정도는 돼야 제목 텍스트를 읽을 수 있다고 보고 표시 여부를 가른다.
const MIN_LEAF_LABEL_PX_W = 28;
const MIN_LEAF_LABEL_PX_H = 13;
const LEAF_FONT_SIZE = 7;
const HEADER_FONT_SIZE = 11;
const TILE_TITLE_FONT_SIZE = 18;
const TILE_SUB_FONT_SIZE = 12;
// 한글은 대체로 폰트 크기와 비슷한 폭(전각)을 차지하지만, 기사 제목엔 숫자·문장부호·
// 영문 이니셜처럼 더 좁은 글자도 섞여 있어 1.0으로 잡으면 실제보다 훨씬 적게 truncate된다.
// fitAttrs()가 넘칠 때 glyph를 눌러주는 안전장치 역할을 하므로, 여기는 조금 낙관적으로
// 잡아서 웬만하면 더 많은 글자가 그대로 보이게 한다.
const CJK_CHAR_WIDTH_EM = 0.82;

interface LeafDatum {
  article: Article;
  value: 1;
}
interface ClusterDatum {
  cluster: Cluster;
  children: LeafDatum[];
}
interface RootDatum {
  children: ClusterDatum[];
}

type RectNode = d3.HierarchyRectangularNode<RootDatum | ClusterDatum | LeafDatum>;

function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return text.slice(0, maxChars - 1) + "…";
}

// 클러스터 타일 글자색 — 배경마다 다르게 고르면(밝기 대비) 타일별로 글자색이 하양/검정
// 섞여서 오히려 산만해 보인다. 흰색 하나로 고정해서 항상 통일된 인상을 준다.
const TILE_TEXT_COLOR = "#f8fafc";

// SVG textLength는 축소 방향으로만 걸어야 한다(자연 폭보다 넓게 주면 짧은 글자가
// 억지로 늘어나 보인다) — 필요할 때만 속성을 얹는 공용 헬퍼.
function fitAttrs(naturalW: number, availW: number) {
  return naturalW > availW ? { textLength: availW, lengthAdjust: "spacingAndGlyphs" as const } : {};
}

export function ClusterTreemap({
  articles,
  clusters,
  selectedClusterId = null,
  selectedArticleId = null,
  onSelectCluster,
  onSelectArticle,
}: {
  articles: Article[];
  clusters: Cluster[];
  selectedClusterId?: number | null;
  selectedArticleId?: string | null;
  onSelectCluster: (clusterId: number) => void;
  onSelectArticle: (articleId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null);
  const [hoveredArticle, setHoveredArticle] = useState<string | null>(null);

  // cluster.size/sentiment_dist는 전체 기간 합산치라, 날짜 등으로 필터링된 articles가
  // 들어와도 그대로 쓰면 숫자가 안 맞는다 — 실제로 렌더 중인 articles 기준으로 다시 센다.
  const statsByCluster = useMemo(() => computeClusterStats(articles), [articles]);

  const root = useMemo(() => {
    const byCluster = new Map<number, Article[]>();
    for (const a of articles) {
      const list = byCluster.get(a.cluster_id);
      if (list) list.push(a);
      else byCluster.set(a.cluster_id, [a]);
    }

    const data: RootDatum = {
      children: clusters
        .map((c) => ({
          cluster: c,
          children: (byCluster.get(c.id) ?? []).map((a) => ({ article: a, value: 1 as const })),
        }))
        .filter((c) => c.children.length > 0),
    };

    const hierarchy = d3
      .hierarchy<RootDatum | ClusterDatum | LeafDatum>(data, (d) => ("children" in d ? d.children : undefined))
      .sum((d) => ("value" in d ? d.value : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    d3
      .treemap<RootDatum | ClusterDatum | LeafDatum>()
      .size([VIEW_W, VIEW_H])
      // depth 0(=클러스터 사이) 여백을 depth 1(=기사 사이)보다 훨씬 넉넉하게 둬서,
      // 축소 모드에서 카드처럼 뚝뚝 떨어져 보이고 확대했을 때만 기사 그리드가 빽빽해진다.
      .paddingOuter((d) => (d.depth === 0 ? 10 : 3))
      .paddingTop((d) => (d.depth === 1 ? HEADER_H : 0))
      .paddingInner((d) => (d.depth === 0 ? 10 : 1.5))
      .round(true)(hierarchy);

    return hierarchy as RectNode;
  }, [articles, clusters]);

  const clusterNodes = useMemo(
    () => (root.children ?? []) as d3.HierarchyRectangularNode<ClusterDatum>[],
    [root],
  );
  const leafNodes = useMemo(() => root.leaves() as d3.HierarchyRectangularNode<LeafDatum>[], [root]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([
        [0, 0],
        [VIEW_W, VIEW_H],
      ])
      .on("zoom", (event) => setTransform(event.transform));
    d3.select(svg).call(zoom);
    return () => {
      d3.select(svg).on(".zoom", null);
    };
  }, []);

  const mode: "cluster" | "article" = transform.k < ARTICLE_ZOOM_THRESHOLD ? "cluster" : "article";

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {mode === "cluster"
            ? clusterNodes.map((c) => {
                const { cluster } = c.data;
                const stats = statsByCluster.get(cluster.id) ?? EMPTY_STATS;
                const isActive = hoveredCluster === cluster.id || selectedClusterId === cluster.id;
                const w = c.x1 - c.x0;
                const h = c.y1 - c.y0;
                const cx = (c.x0 + c.x1) / 2;
                const cy = (c.y0 + c.y1) / 2;
                const availTitleW = w - 14;
                const titleMaxChars = Math.max(
                  0,
                  Math.floor(availTitleW / (TILE_TITLE_FONT_SIZE * CJK_CHAR_WIDTH_EM)),
                );
                const title = truncate(cluster.label, titleMaxChars);
                const titleNaturalW = title.length * TILE_TITLE_FONT_SIZE * CJK_CHAR_WIDTH_EM;
                const showText = w > 46 && h > 32 && title;
                return (
                  <g key={cluster.id}>
                    <rect
                      x={c.x0}
                      y={c.y0}
                      width={Math.max(0, w)}
                      height={Math.max(0, h)}
                      rx={8}
                      fill={clusterColor(cluster.id)}
                      stroke={isActive ? "white" : "rgba(255,255,255,0.25)"}
                      strokeWidth={(isActive ? 3 : 1) / transform.k}
                      style={{ pointerEvents: "all", cursor: "pointer" }}
                      onMouseEnter={() => setHoveredCluster(cluster.id)}
                      onMouseLeave={() => setHoveredCluster((v) => (v === cluster.id ? null : v))}
                      onClick={() => onSelectCluster(cluster.id)}
                    >
                      <title>{`${cluster.label} · ${stats.size}건`}</title>
                    </rect>
                    {showText && (
                      <>
                        <text
                          x={cx}
                          y={cy - 8}
                          fontSize={TILE_TITLE_FONT_SIZE}
                          fontWeight={700}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={TILE_TEXT_COLOR}
                          {...fitAttrs(titleNaturalW, availTitleW)}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {title}
                        </text>
                        <text
                          x={cx}
                          y={cy + 13}
                          fontSize={TILE_SUB_FONT_SIZE}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={TILE_TEXT_COLOR}
                          fillOpacity={0.8}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {stats.size}건
                        </text>
                      </>
                    )}
                  </g>
                );
              })
            : (
              <>
                {clusterNodes.map((c) => {
                  const { cluster } = c.data;
                  const stats = statsByCluster.get(cluster.id) ?? EMPTY_STATS;
                  const isActive = hoveredCluster === cluster.id || selectedClusterId === cluster.id;
                  const w = c.x1 - c.x0;
                  const h = c.y1 - c.y0;
                  const availLabelW = w - 6;
                  const maxChars = Math.max(0, Math.floor(availLabelW / (HEADER_FONT_SIZE * CJK_CHAR_WIDTH_EM)));
                  const label = truncate(`${cluster.label} · ${stats.size}건`, maxChars);
                  const labelNaturalW = label.length * HEADER_FONT_SIZE * CJK_CHAR_WIDTH_EM;
                  return (
                    <g key={cluster.id}>
                      <rect
                        x={c.x0}
                        y={c.y0}
                        width={Math.max(0, w)}
                        height={Math.max(0, h)}
                        fill={isActive ? clusterColor(cluster.id) : "#020617"}
                        fillOpacity={isActive ? 0.18 : 1}
                        stroke={isActive ? "white" : "rgba(255,255,255,0.25)"}
                        strokeWidth={(isActive ? 2 : 1) / transform.k}
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                        onMouseEnter={() => setHoveredCluster(cluster.id)}
                        onMouseLeave={() => setHoveredCluster((v) => (v === cluster.id ? null : v))}
                        onClick={() => onSelectCluster(cluster.id)}
                      />
                      {h > HEADER_H - 2 && w > 12 && label && (
                        <text
                          x={c.x0 + 4}
                          y={c.y0 + HEADER_H - 6.5}
                          fontSize={HEADER_FONT_SIZE}
                          fontWeight={600}
                          fill={isActive ? "white" : "#cbd5e1"}
                          {...fitAttrs(labelNaturalW, availLabelW)}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {leafNodes.map((leaf) => {
                  const { article } = leaf.data;
                  const isActive = hoveredArticle === article.id || selectedArticleId === article.id;
                  const w = leaf.x1 - leaf.x0;
                  const h = leaf.y1 - leaf.y0;
                  const screenW = w * transform.k;
                  const screenH = h * transform.k;
                  const showLabel = screenW >= MIN_LEAF_LABEL_PX_W && screenH >= MIN_LEAF_LABEL_PX_H;
                  const availLeafW = w - 4;
                  const maxChars = Math.max(0, Math.floor(availLeafW / (LEAF_FONT_SIZE * CJK_CHAR_WIDTH_EM)));
                  const label = showLabel ? truncate(article.title, maxChars) : "";
                  const labelNaturalW = label.length * LEAF_FONT_SIZE * CJK_CHAR_WIDTH_EM;
                  return (
                    <g key={article.id}>
                      <rect
                        x={leaf.x0}
                        y={leaf.y0}
                        width={Math.max(0, w)}
                        height={Math.max(0, h)}
                        fill={SENTIMENT_COLOR[article.sentiment]}
                        fillOpacity={isActive ? 1 : 0.82}
                        stroke={isActive ? "white" : "#020617"}
                        strokeWidth={(isActive ? 1.5 : 0.5) / transform.k}
                        style={{ pointerEvents: "all", cursor: "pointer" }}
                        onMouseEnter={() => setHoveredArticle(article.id)}
                        onMouseLeave={() => setHoveredArticle((v) => (v === article.id ? null : v))}
                        onClick={() => onSelectArticle(article.id)}
                      >
                        <title>{article.title}</title>
                      </rect>
                      {label && (
                        <text
                          x={leaf.x0 + w / 2}
                          y={leaf.y0 + h / 2}
                          fontSize={LEAF_FONT_SIZE}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#0f172a"
                          {...fitAttrs(labelNaturalW, availLeafW)}
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </>
            )}
        </g>
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded-md bg-black/50 px-2 py-1 text-[11px] text-slate-300">
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full" style={{ background: SENTIMENT_COLOR.pos }} />
          긍정
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full" style={{ background: SENTIMENT_COLOR.neu }} />
          중립
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block size-2 rounded-full" style={{ background: SENTIMENT_COLOR.neg }} />
          부정
        </span>
        <span className="text-slate-400">· 확대 {transform.k.toFixed(1)}x</span>
      </div>
    </div>
  );
}
