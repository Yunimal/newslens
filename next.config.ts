import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/ask는 런타임에 data/*.json을 fs로 읽는다. output file tracing이 기본적으로
  // 이 JSON들을 프루닝하므로, 서버리스 함수 번들에 명시적으로 포함시킨다. (Next 16 top-level 키)
  outputFileTracingIncludes: {
    "/api/ask": ["./data/**/*.json"],
  },
};

export default nextConfig;
