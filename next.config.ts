import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Khung bài giảng Excel đọc từ đĩa khi tải về: đưa vào bản standalone.
  outputFileTracingIncludes: { "/api/quan-tri/content/template": ["./src/assets/khung-bai-giang-mau.xlsx"] },
};

export default nextConfig;
