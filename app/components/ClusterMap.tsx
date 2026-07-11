"use client";

// 이슈 지도(클러스터 맵). 줌아웃 시 밀도 히트맵, 줌인 시 개별 기사 점을 그린다.
// 렌더 모드 전환은 d3-zoom 이 보고하는 transform.k(스케일)만으로 결정한다.
//
// 히트맵은 "시각"과 "상호작용"을 레이어로 분리한다:
//  - canvas(아래): 369개 기사의 실제 좌표에 작은 glow를 additive(lighter) 합성으로 누적 —
//    점 하나는 작은 빛, 여러 점이 겹치는 곳만 자연스럽게 밝아지는 진짜 density 히트맵.
//  - svg(위): 클러스터 centroid에 거의 투명한 히트 타겟 원을 얹어 hover/click만 담당.
//    (캔버스는 React 상태로 다시 그릴 수 없으니 클릭 판정을 여기서 분리했다)

import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { Article, Cluster } from "@/types/schema";
import { clusterColor } from "../lib/clusterColors";
import { computeClusterStats } from "../lib/clusterStats";

// 임시값 — 실데이터 렌더링 후 점 겹침 정도를 보면서 조정한다.
export const HEATMAP_ZOOM_THRESHOLD = 2.5;
// 이 배율을 넘어가면(그래도 아직 scatter 모드 전인 구간) 말풍선 라벨은 화면을 가리지
// 않도록 먼저 감춘다 — 이 정도로 확대했으면 이미 원 자체가 커서 라벨 없이도 위치를
// 알아보기 쉽고, 라벨이 화면을 가릴 정도로 커 보이기 시작한다.
const LABEL_VISIBLE_ZOOM_THRESHOLD = 2.0;

const VIEW_W = 1000;
const VIEW_H = 700;
const PADDING = 60;
const POINT_BASE_R = 5;
// 히트 타겟(클릭 판정) 원 반지름 — 더 이상 시각적 블롭이 아니라 클릭 영역일 뿐이라
// 거의 안 보이게 그린다. 실제 밀도 표현은 canvas가 담당한다.
const HIT_TARGET_MIN_R = 26;
const HIT_TARGET_MAX_R = 68;
// 기사 점 하나당 캔버스에 그리는 glow 반지름/농도. halo가 너무 작으면 점끼리 안 겹쳐서
// "모여있으면 더 크게 보이는" 밀도 효과가 안 산다 — 코어(아래)가 개별 점의 또렷함을,
// halo는 겹침에 의한 밀도감을 각각 담당하도록 역할을 나눈다.
const DOT_GLOW_R = 13.5;
const DOT_ALPHA = 0.7;
// halo 위에 덧그리는 밝은 코어 — 점 하나하나가 별처럼 또렷이 보이게 하는 용도.
const DOT_CORE_R = 3.6;
const DOT_CORE_ALPHA = 0.5;

// 말풍선 라벨 — 히트맵 모드에서 어느 덩어리가 무슨 주제인지 늘 보이도록, 각 덩어리의
// centroid에서 "지도 중심 반대 방향"으로 일정 거리 밀어낸 위치에 라벨 칩을 놓고
// centroid까지 꼬리(삼각형)+점선으로 잇는다.
//
// 라벨은 pan/zoom이 걸린 <g transform="scale(k)...">의 바깥, 별도의 스크린 좌표계
// <g>에 그린다(캔버스가 transform.apply()로 화면 좌표를 직접 계산하는 것과 동일한
// 방식). 처음엔 라벨을 데이터 좌표계 안에 두고 오프셋만 1/k로 보정했었는데, centroid가
// 캔버스 경계 근처라 clamp가 걸리는 클러스터는 clamp된 "데이터 좌표 간격" 자체가
// 다시 줌에 비례해 줄어들어 축소하면 또 겹쳐버렸다. 화면 좌표계로 완전히 빼면
// 오프셋·여백·clamp 전부 줌과 무관한 고정 픽셀값이 되어 이 문제가 근본적으로 없어진다.
const LABEL_OFFSET = 150;
const LABEL_FONT_SIZE = 15;
const LABEL_CHAR_WIDTH_EM = 0.85;
const LABEL_PAD_X = 10;
const LABEL_PAD_Y = 8;
const LABEL_TAIL_LEN = 12;
const LABEL_TAIL_HALF_W = 7;
const LABEL_MAX_CHARS = 20;

type Mode = "heatmap" | "scatter";

function truncateLabel(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)) + "…";
}

export function ClusterMap({
  articles,
  allArticles,
  clusters,
  selectedClusterId = null,
  selectedArticleId = null,
  onSelectCluster,
  onSelectArticle,
}: {
  articles: Article[];
  // 지도 좌표계(xScale/yScale)의 기준 — 날짜 등으로 articles를 필터링해도 지도 자체는
  // 흔들리지 않도록, 필터링 전 전체 기사 목록을 넘기면 그걸로 domain을 고정한다.
  // 안 넘기면 articles로 계산(기존 동작과 동일).
  allArticles?: Article[];
  clusters: Cluster[];
  selectedClusterId?: number | null;
  selectedArticleId?: string | null;
  onSelectCluster: (clusterId: number) => void;
  onSelectArticle: (articleId: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [transform, setTransform] = useState<d3.ZoomTransform>(d3.zoomIdentity);
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null);
  const [hoveredArticle, setHoveredArticle] = useState<string | null>(null);

  // cluster.size/sentiment_dist는 전체 기간 합산치라, 날짜 등으로 필터링된 articles가
  // 들어와도 그대로 쓰면 숫자가 안 맞는다 — 실제로 렌더 중인 articles 기준으로 다시 센다.
  const statsByCluster = useMemo(() => computeClusterStats(articles), [articles]);

  // 데이터 좌표(UMAP x,y) → 뷰박스 픽셀 좌표. domain은 필터링 전 전체 기사 기준으로 고정해서,
  // 날짜를 바꿔도 지도 자체(축척)는 그대로고 그 위에 찍히는 점만 바뀌게 한다.
  const { xScale, yScale } = useMemo(() => {
    const domainSource = allArticles ?? articles;
    const xs = domainSource.map((a) => a.x);
    const ys = domainSource.map((a) => a.y);
    const x = d3
      .scaleLinear()
      .domain([Math.min(...xs), Math.max(...xs)])
      .range([PADDING, VIEW_W - PADDING]);
    // SVG는 y가 아래로 갈수록 증가 — 데이터상 "위"가 화면에서도 위로 오도록 range를 뒤집는다.
    const y = d3
      .scaleLinear()
      .domain([Math.min(...ys), Math.max(...ys)])
      .range([VIEW_H - PADDING, PADDING]);
    return { xScale: x, yScale: y };
  }, [allArticles, articles]);

  // 화면에 실제로 보여줄 클러스터 — 선택된 날짜에 기사가 0건이면 덩어리도, 말풍선도 안 그린다.
  const visibleClusters = useMemo(
    () => clusters.filter((c) => (statsByCluster.get(c.id)?.size ?? 0) > 0),
    [clusters, statsByCluster],
  );

  // 면적이 실제 기사 수에 비례하도록 domain을 0부터 잡는다(scaleSqrt: 반지름이 아니라
  // 면적을 값에 비례시킴). min~max로 domain을 잡으면 작은 클러스터가 실제보다 훨씬
  // 작아 보여 개수 차이를 왜곡한다 — 정직한 크기 비교가 우선이라 여기선 과장하지 않는다.
  const hitTargetRadius = useMemo(() => {
    const maxSize = Math.max(...visibleClusters.map((c) => statsByCluster.get(c.id)?.size ?? 0), 1);
    return d3.scaleSqrt().domain([0, maxSize]).range([HIT_TARGET_MIN_R, HIT_TARGET_MAX_R]).clamp(true);
  }, [visibleClusters, statsByCluster]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 30])
      .on("zoom", (event) => setTransform(event.transform));
    d3.select(svg).call(zoom);
    return () => {
      d3.select(svg).on(".zoom", null);
    };
  }, []);

  const mode: Mode = transform.k < HEATMAP_ZOOM_THRESHOLD ? "heatmap" : "scatter";

  // 밀도 캔버스 — 369개 기사 각각을 실제 좌표에 작은 radial glow로 그리고,
  // globalCompositeOperation="lighter"로 누적한다. svg의 <g transform=...>과 동일하게
  // transform.apply()로 좌표를 옮기므로 pan/zoom 중에도 scatter 점들과 정확히 겹친다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "heatmap") return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.globalCompositeOperation = "lighter";

    for (const a of articles) {
      const [cx, cy] = transform.apply([xScale(a.x), yScale(a.y)]);
      if (cx < -DOT_GLOW_R || cx > VIEW_W + DOT_GLOW_R || cy < -DOT_GLOW_R || cy > VIEW_H + DOT_GLOW_R) {
        continue; // 화면 밖 점은 스킵 (성능)
      }
      const rgb = d3.rgb(clusterColor(a.cluster_id));
      // 바깥 halo — 겹칠수록 additive로 누적되어 밀도 표현
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, DOT_GLOW_R);
      grad.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},${DOT_ALPHA})`);
      grad.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, DOT_GLOW_R, 0, Math.PI * 2);
      ctx.fill();

      // 밝은 코어 — halo만으로는 점 하나하나가 뭉개져 보여서, 흰색 쪽으로 밝힌 작은
      // 점을 덧그려 개별 기사가 "별처럼" 또렷이 보이게 한다.
      const core = d3.rgb(d3.interpolateRgb(clusterColor(a.cluster_id), "#ffffff")(0.6));
      ctx.fillStyle = `rgba(${core.r},${core.g},${core.b},${DOT_CORE_ALPHA})`;
      ctx.beginPath();
      ctx.arc(cx, cy, DOT_CORE_R, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [mode, transform, articles, xScale, yScale]);

  // sqrt(k)로 보정 — 완전히 고정(÷k)하면 확대해도 점이 하나도 안 커져서 "듬성듬성"해
  // 보인다. 화면상 크기가 zoom에 따라 서서히(sqrt 비율로) 커지도록 절충한다.
  const pointR = POINT_BASE_R / Math.sqrt(transform.k);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
      {mode === "heatmap" && (
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full touch-none"
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {mode === "heatmap"
            ? visibleClusters.map((c) => {
                const isActive = hoveredCluster === c.id || selectedClusterId === c.id;
                const size = statsByCluster.get(c.id)?.size ?? 0;
                return (
                  <circle
                    key={c.id}
                    cx={xScale(c.centroid.x)}
                    cy={yScale(c.centroid.y)}
                    r={hitTargetRadius(size)}
                    fill={clusterColor(c.id)}
                    fillOpacity={isActive ? 0.12 : 0.02}
                    stroke={isActive ? "white" : "none"}
                    strokeWidth={isActive ? 2 / transform.k : 0}
                    style={{ pointerEvents: "all" }}
                    onMouseEnter={() => setHoveredCluster(c.id)}
                    onMouseLeave={() => setHoveredCluster((v) => (v === c.id ? null : v))}
                    onClick={() => onSelectCluster(c.id)}
                    className="cursor-pointer"
                  >
                    <title>{`${c.label} (${size}건)`}</title>
                  </circle>
                );
              })
            : articles.map((a) => {
                const isActive = hoveredArticle === a.id || selectedArticleId === a.id;
                return (
                  <circle
                    key={a.id}
                    cx={xScale(a.x)}
                    cy={yScale(a.y)}
                    r={isActive ? pointR * 1.8 : pointR}
                    fill={clusterColor(a.cluster_id)}
                    fillOpacity={isActive ? 1 : 0.85}
                    stroke={isActive ? "white" : "none"}
                    strokeWidth={isActive ? 1.5 / transform.k : 0}
                    onMouseEnter={() => setHoveredArticle(a.id)}
                    onMouseLeave={() => setHoveredArticle((v) => (v === a.id ? null : v))}
                    onClick={() => onSelectArticle(a.id)}
                    className="cursor-pointer"
                  >
                    <title>{a.title}</title>
                  </circle>
                );
              })}
        </g>

        {/* 말풍선 라벨 — pan/zoom이 걸린 <g> 밖, 화면 좌표계에 직접 그린다(위 주석 참고).
            centroid의 실제 화면 위치는 캔버스와 동일하게 transform.apply()로 구한다.
            LABEL_VISIBLE_ZOOM_THRESHOLD를 넘게 확대하면(아직 scatter 전환 전이라도)
            원이 이미 커서 라벨 없이도 알아보기 쉬우니, 화면을 가리지 않게 먼저 뺀다. */}
        {mode === "heatmap" && transform.k <= LABEL_VISIBLE_ZOOM_THRESHOLD && (
          <g>
            {visibleClusters.map((c) => {
              const isActive = hoveredCluster === c.id || selectedClusterId === c.id;
              const [ccx, ccy] = transform.apply([xScale(c.centroid.x), yScale(c.centroid.y)]);
              const mapCx = VIEW_W / 2;
              const mapCy = VIEW_H / 2;
              // centroid가 지도 중심에서 뻗어나간 방향 그대로, 화면상 LABEL_OFFSET
              // 픽셀만큼 더 밀어낸다.
              const angle = Math.atan2(ccy - mapCy, ccx - mapCx);
              const text = truncateLabel(c.label, LABEL_MAX_CHARS);
              const textW = text.length * LABEL_FONT_SIZE * LABEL_CHAR_WIDTH_EM;
              const rectHalfW = textW / 2 + LABEL_PAD_X;
              const rectHalfH = LABEL_FONT_SIZE / 2 + LABEL_PAD_Y;
              // 화면 좌표계라 clamp도 뷰박스 전체([0,VIEW_W]x[0,VIEW_H])를 그대로 쓸 수
              // 있다 — data padding에 안 묶이니 centroid가 가장자리에 있어도 밀어낼
              // 여유 공간이 항상 확보된다.
              const lx = Math.min(VIEW_W - rectHalfW - 4, Math.max(rectHalfW + 4, ccx + Math.cos(angle) * LABEL_OFFSET));
              const ly = Math.min(VIEW_H - rectHalfH - 4, Math.max(rectHalfH + 4, ccy + Math.sin(angle) * LABEL_OFFSET));

              const dx = ccx - lx;
              const dy = ccy - ly;
              const len = Math.hypot(dx, dy) || 1;
              const ux = dx / len;
              const uy = dy / len;
              // 라벨 중심에서 (ux,uy) 방향으로 쏜 광선이 사각형 테두리와 만나는 지점 —
              // 그 지점에서 꼬리 삼각형을 시작해야 말풍선처럼 자연스럽게 이어붙는다.
              const t = 1 / Math.max(Math.abs(ux) / rectHalfW, Math.abs(uy) / rectHalfH, 1e-6);
              const edgeX = lx + ux * t;
              const edgeY = ly + uy * t;
              const tipX = lx + ux * (t + LABEL_TAIL_LEN);
              const tipY = ly + uy * (t + LABEL_TAIL_LEN);
              const perpX = -uy * LABEL_TAIL_HALF_W;
              const perpY = ux * LABEL_TAIL_HALF_W;

              return (
                <g
                  key={`label-${c.id}`}
                  style={{ pointerEvents: "all", cursor: "pointer" }}
                  onMouseEnter={() => setHoveredCluster(c.id)}
                  onMouseLeave={() => setHoveredCluster((v) => (v === c.id ? null : v))}
                  onClick={() => onSelectCluster(c.id)}
                >
                  <line
                    x1={tipX}
                    y1={tipY}
                    x2={ccx}
                    y2={ccy}
                    stroke={clusterColor(c.id)}
                    strokeOpacity={isActive ? 0.85 : 0.4}
                    strokeWidth={isActive ? 1.8 : 1.2}
                    strokeDasharray="3,3"
                  />
                  <polygon
                    points={`${edgeX - perpX},${edgeY - perpY} ${edgeX + perpX},${edgeY + perpY} ${tipX},${tipY}`}
                    fill={clusterColor(c.id)}
                  />
                  <rect
                    x={lx - rectHalfW}
                    y={ly - rectHalfH}
                    width={rectHalfW * 2}
                    height={rectHalfH * 2}
                    rx={8}
                    fill={clusterColor(c.id)}
                    stroke={isActive ? "white" : "none"}
                    strokeWidth={2}
                  />
                  <text
                    x={lx}
                    y={ly}
                    fontSize={LABEL_FONT_SIZE}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#f8fafc"
                    style={{ userSelect: "none" }}
                  >
                    {text}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* threshold 튜닝용 디버그 표시 — 확정되면 제거 */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-1 text-[11px] text-slate-300">
        zoom {transform.k.toFixed(2)} · {mode}
      </div>
    </div>
  );
}
