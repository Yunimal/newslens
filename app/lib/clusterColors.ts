// 클러스터 id → 색상. Tableau10 팔레트를 순환시켜 클러스터 개수가 늘어나도 안전.
import { schemeTableau10 } from "d3";

export function clusterColor(clusterId: number): string {
  return schemeTableau10[clusterId % schemeTableau10.length];
}
