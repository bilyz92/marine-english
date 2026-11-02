import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/hoc", "/tai-khoan", "/thanh-toan", "/mua", "/api"] } };
}
