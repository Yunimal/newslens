import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker/Node 배포용 standalone 서버 산출물을 생성한다.
  output: "standalone",

  // /api/ask는 런타임에 data/*.json을 fs로 읽는다. output file tracing이 기본적으로
  // 이 JSON들을 프루닝하므로, 서버리스 함수 번들에 명시적으로 포함시킨다. (Next 16 top-level 키)
  outputFileTracingIncludes: {
    "/api/ask": ["./data/**/*.json"],
    // /api/articles 도 런타임에 data/*.json 을 fs 로 읽으므로 번들에 포함.
    "/api/articles": ["./data/**/*.json"],
  },

  // 상위 홈 디렉터리의 다른 lockfile을 workspace root로 오인하지 않게 고정한다.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
