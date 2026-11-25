import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { PAGE_SEO, siteUrl } from "@/lib/seo";
import { listPublishedCatalog } from "@/modules/content/catalog";

/**
 * Trang công khai, khóa đang bán và bài học thử của chúng. Không có khóa nháp, khóa "Sắp ra mắt", trang mua, thanh toán, đơn hàng,
 * đăng nhập, tài khoản, app học. Dựng theo yêu cầu: APP_ORIGIN và danh mục đọc lúc chạy, không đóng băng lúc build.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const origin = env().APP_ORIGIN;
  const { courses } = await listPublishedCatalog();
  const paths = [
    ...Object.values(PAGE_SEO).map((p) => p.path),
    ...courses
      .filter((c) => !c.comingSoon)
      .flatMap((c) => [`/khoa-hoc/${c.slug}`, ...c.trialLessons.map((t) => `/khoa-hoc/${c.slug}/hoc-thu/${t.position}`)]),
  ];
  return paths.map((path) => ({ url: siteUrl(path, origin) }));
}
