import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { siteUrl } from "@/lib/seo";

// Đọc APP_ORIGIN lúc chạy (bản build không có biến môi trường), nên robots.txt dựng theo yêu cầu.
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/hoc", "/tai-khoan", "/thanh-toan", "/mua", "/api"] },
    sitemap: siteUrl("/sitemap.xml"),
  };
}
