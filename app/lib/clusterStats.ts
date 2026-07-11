// Cluster.size/sentiment_dist는 전체 수집 기간(현재 7/8~7/9) 합산치다. 날짜별로 필터링한
// article 목록을 넘기면, 그 날짜만 기준으로 한 클러스터별 건수·논조 분포를 다시 집계한다.

import type { Article, Sentiment } from "@/types/schema";

export interface ClusterStats {
  size: number;
  sentiment_dist: Record<Sentiment, number>;
}

export function computeClusterStats(articles: Article[]): Map<number, ClusterStats> {
  const map = new Map<number, ClusterStats>();
  for (const a of articles) {
    let stats = map.get(a.cluster_id);
    if (!stats) {
      stats = { size: 0, sentiment_dist: { pos: 0, neu: 0, neg: 0 } };
      map.set(a.cluster_id, stats);
    }
    stats.size += 1;
    stats.sentiment_dist[a.sentiment] += 1;
  }
  return map;
}
