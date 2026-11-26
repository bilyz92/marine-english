import { prisma } from "@/lib/db";
import { categoryUrl, courseUrl, trialUrl } from "./paths";
import { OTHER_CATEGORY_URL_SLUG } from "./url-slug";

// Đường dẫn công khai của khóa và danh mục (SEO, chủ 26/11/2026). Trang dựng theo luồng (Cache Components) gửi mã 200 trước khi biết
// khóa có hay không, nên 404 thật và chuyển hướng vĩnh viễn được quyết ở proxy (src/proxy.ts) bằng hàm này, trước khi trang chạy.
// Trang vẫn tự gọi notFound() khi dữ liệu đổi giữa chừng.

export type PublicRoute = { kind: "ok" } | { kind: "redirect"; to: string } | { kind: "not_found" };

const OK: PublicRoute = { kind: "ok" };
const NOT_FOUND: PublicRoute = { kind: "not_found" };
const POSITION = /^[1-9][0-9]{0,5}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/**
 * Khóa đang bán ứng với một đoạn đường dẫn: đường dẫn hiện tại, mã nội bộ, hoặc đường dẫn cũ chủ đã đổi. `current` = đúng đường dẫn
 * hiện tại (không cần chuyển hướng). Khóa nháp, sắp ra mắt: null (404, không lộ đường dẫn).
 */
async function publishedCourseFor(segment: string): Promise<{ urlSlug: string; current: boolean } | null> {
  const [row] = await prisma().$queryRaw<{ url_slug: string; current: boolean }[]>`
    SELECT c.url_slug, c.url_slug = ${segment} AS current FROM courses c
    WHERE c.status = 'published'
      AND (c.url_slug = ${segment} OR c.slug = ${segment}
           OR c.id IN (SELECT h.course_id FROM course_url_slug_history h WHERE h.url_slug = ${segment}))
    ORDER BY c.url_slug = ${segment} DESC, c.slug = ${segment} DESC
    LIMIT 1`;
  return row ? { urlSlug: row.url_slug, current: row.current } : null;
}

async function isTrial(urlSlug: string, position: string): Promise<boolean> {
  if (!POSITION.test(position)) return false;
  const rows = await prisma().$queryRaw<{ hit: number }[]>`
    SELECT 1 AS hit FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    WHERE c.url_slug = ${urlSlug} AND c.status = 'published' AND cvl.position = ${Number(position)} AND cvl.is_free_trial`;
  return rows.length > 0;
}

/** Danh mục hiện được khi nó (hoặc danh mục con của nó) có khóa đang bán hay sắp ra mắt, như lưới trên /khoa-hoc. */
async function categoryVisible(urlSlug: string): Promise<boolean> {
  const rows = urlSlug === OTHER_CATEGORY_URL_SLUG
    ? await prisma().$queryRaw<{ hit: number }[]>`
        SELECT 1 AS hit FROM courses WHERE category_id IS NULL AND status IN ('published', 'archived') LIMIT 1`
    : await prisma().$queryRaw<{ hit: number }[]>`
        SELECT 1 AS hit FROM course_categories cc JOIN courses co ON co.category_id = cc.id OR co.category_id IN (SELECT id FROM course_categories WHERE parent_id = cc.id)
        WHERE cc.url_slug = ${urlSlug} AND co.status IN ('published', 'archived') LIMIT 1`;
  return rows.length > 0;
}

/** ?dm=<id> cũ (trước 26/11/2026) → /khoa-hoc/danh-muc/<đường dẫn>; dm lạ → /khoa-hoc. Các tham số khác giữ nguyên. */
async function legacyCategoryRedirect(dm: string, rest: URLSearchParams): Promise<PublicRoute> {
  let target = "/khoa-hoc";
  if (dm === OTHER_CATEGORY_URL_SLUG) target = categoryUrl(OTHER_CATEGORY_URL_SLUG);
  else if (UUID.test(dm)) {
    const [row] = await prisma().$queryRaw<{ url_slug: string }[]>`SELECT url_slug FROM course_categories WHERE id = ${dm}::uuid`;
    if (row) target = categoryUrl(row.url_slug);
  }
  const query = rest.toString();
  return { kind: "redirect", to: query ? `${target}?${query}` : target };
}

/**
 * Quyết định cho một yêu cầu trang công khai dưới /khoa-hoc: hiện (ok), chuyển hướng vĩnh viễn, hay 404. null = không phải đường dẫn
 * hàm này quản (proxy cho đi tiếp như mọi trang khác). `search` là chuỗi truy vấn của yêu cầu ("" hoặc "?…"), giữ khi chuyển hướng.
 */
export async function routePublicPath(pathname: string, search: string): Promise<PublicRoute | null> {
  if (pathname === "/khoa-hoc") {
    const params = new URLSearchParams(search);
    const dm = params.get("dm");
    if (dm === null) return null;
    params.delete("dm");
    return legacyCategoryRedirect(dm, params);
  }
  const parts = pathname.split("/").slice(2);
  if (pathname.split("/")[1] !== "khoa-hoc" || parts.some((p) => p === "")) return null;
  if (parts[0] === "danh-muc") return parts.length === 2 ? ((await categoryVisible(parts[1]!)) ? OK : NOT_FOUND) : parts.length === 1 ? NOT_FOUND : null;
  const isCourse = parts.length === 1;
  const isTrialPage = parts.length === 3 && parts[1] === "hoc-thu";
  if (!isCourse && !isTrialPage) return null;
  const course = await publishedCourseFor(parts[0]!);
  if (!course) return NOT_FOUND;
  if (isTrialPage && !(await isTrial(course.urlSlug, parts[2]!))) return NOT_FOUND;
  if (course.current) return OK;
  const to = isTrialPage ? trialUrl(course.urlSlug, Number(parts[2])) : courseUrl(course.urlSlug);
  return { kind: "redirect", to: `${to}${search}` };
}
