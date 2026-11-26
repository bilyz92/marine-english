import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { PAGE_SEO, siteUrl } from "@/lib/seo";
import { listArticles } from "@/modules/articles/articles";
import { listPublishedCatalog } from "@/modules/content/catalog";
import { categoryUrl, courseUrl, trialUrl } from "@/modules/content/paths";

/**
 * Trang công khai, khóa đang bán và bài học thử của chúng, trang danh mục (và danh mục con) có khóa đang bán, bài viết. Không có khóa nháp, khóa
 * "Sắp ra mắt", trang mua, thanh toán, đơn hàng, đăng nhập, tài khoản, app học. Dựng theo yêu cầu: APP_ORIGIN và danh mục đọc lúc
 * chạy, không đóng băng lúc build.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = env().APP_ORIGIN;
  const { courses, groups } = await listPublishedCatalog();
  const onSale = (list: { comingSoon: boolean }[]) => list.some((c) => !c.comingSoon);
  const paths = [
    ...Object.values(PAGE_SEO).map((p) => p.path),
    ...courses
      .filter((c) => !c.comingSoon)
      .flatMap((c) => [courseUrl(c.urlSlug), ...c.trialLessons.map((t) => trialUrl(c.urlSlug, t.position))]),
    ...groups.flatMap((g) => [
      ...(g.comingSoon ? [] : [categoryUrl(g.urlSlug)]),
      ...g.subgroups.filter((s) => onSale(s.courses)).map((s) => categoryUrl(s.urlSlug)),
    ]),
    ...listArticles().map((a) => a.path),
  ];
  return paths.map((path) => ({ url: siteUrl(path, origin) }));
}
