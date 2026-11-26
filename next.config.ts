import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  // Khung bài giảng Excel đọc từ đĩa khi tải về: đưa vào bản standalone.
  // Bài viết (content/bai-viet/*.md) đọc từ đĩa lúc chạy (sitemap, proxy trả 404 cho bài không có): đưa vào bản standalone.
  outputFileTracingIncludes: {
    "/api/quan-tri/content/template": ["./src/assets/khung-bai-giang-mau.xlsx"],
    "/sitemap.xml": ["./content/bai-viet/*.md"],
    "/bai-viet": ["./content/bai-viet/*.md"],
    "/bai-viet/[slug]": ["./content/bai-viet/*.md"],
  },
};

export default nextConfig;
