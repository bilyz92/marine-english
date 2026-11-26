// Đường dẫn công khai đọc được (SEO, chủ 26/11/2026): /khoa-hoc/<url_slug>, /khoa-hoc/danh-muc/<url_slug>. Mã khóa nội bộ
// (courses.slug) không đổi. Cùng thuật toán với hàm SQL slugify_vi (migration 20261127090000_readable_urls); test integration
// url-slugs.test.ts giữ hai bên khớp nhau. Chỉ import tương đối/kiểu thuần: bộ nhập (CLI) chạy thẳng bằng Node.

export const URL_SLUG_MAX = 80;
const PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Đường dẫn khóa không được trùng phần tĩnh của route /khoa-hoc/danh-muc/…. */
export const RESERVED_COURSE_URL_SLUGS = ["danh-muc"];
/** "khac" là nhóm "Khóa khác" (khóa chưa có danh mục). */
export const OTHER_CATEGORY_URL_SLUG = "khac";

export const isUrlSlug = (s: string) => s.length <= URL_SLUG_MAX && PATTERN.test(s);

const trimDashes = (s: string) => s.replace(/^-+|-+$/g, "");

/** Bỏ dấu tiếng Việt (đ → d), chữ thường, mọi đoạn không phải chữ/số thành một "-", tối đa 80 ký tự. Rỗng khi không còn chữ/số. */
export function slugify(text: string): string {
  const ascii = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
  return trimDashes(trimDashes(ascii.replace(/[^a-z0-9]+/g, "-")).slice(0, URL_SLUG_MAX));
}

/** Bản thứ n khi trùng: cắt gốc cho vừa 80 ký tự cùng hậu tố "-n". */
export function withSuffix(base: string, n: number): string {
  const suffix = `-${n}`;
  return `${trimDashes(base.slice(0, URL_SLUG_MAX - suffix.length))}${suffix}`;
}

/** Giao diện SQL tối thiểu (pg.Client qua pgSql, hoặc giao dịch Prisma qua prismaSql). */
type Sql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

/** Một khóa giao dịch cho mọi lần chọn/đổi đường dẫn khóa: hai lần nhập cùng tên không chọn trùng một chỗ. */
export async function lockCourseUrlSlugs(sql: Sql): Promise<void> {
  await sql.query(`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext('course-url-slug'))`);
}

/**
 * Đường dẫn đã có chủ: đường dẫn hiện tại hay mã nội bộ của khóa khác, hoặc đường dẫn cũ của khóa khác (link đã chia sẻ vẫn chuyển
 * hướng về khóa đó). `courseId` = khóa đang đổi (đường dẫn cũ của chính nó thì lấy lại được).
 */
export async function courseUrlSlugTaken(sql: Sql, urlSlug: string, courseId: string | null): Promise<boolean> {
  if (RESERVED_COURSE_URL_SLUGS.includes(urlSlug)) return true;
  const rows = await sql.query(
    `SELECT 1 AS hit FROM courses WHERE (url_slug = $1 OR slug = $1) AND id IS DISTINCT FROM $2::uuid
     UNION ALL SELECT 1 FROM course_url_slug_history WHERE url_slug = $1 AND course_id IS DISTINCT FROM $2::uuid LIMIT 1`,
    [urlSlug, courseId],
  );
  return rows.length > 0;
}

/**
 * Mã nội bộ của khóa mới trùng đường dẫn hiện tại hay đường dẫn cũ của khóa khác: /khoa-hoc/<mã> sẽ không còn chuyển về khóa kia
 * (link đã chia sẻ bị cướp), nên từ chối. Gọi sau lockCourseUrlSlugs.
 */
export async function internalSlugClashes(sql: Sql, slug: string): Promise<boolean> {
  const rows = await sql.query(
    `SELECT 1 AS hit FROM courses WHERE url_slug = $1 UNION ALL SELECT 1 FROM course_url_slug_history WHERE url_slug = $1 LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}

/** Đường dẫn cho khóa mới từ tên tiếng Việt: tên không còn chữ thì "khoa-hoc"; trùng thì thêm -2, -3… Gọi sau lockCourseUrlSlugs. */
export async function freeCourseUrlSlug(sql: Sql, titleVi: string): Promise<string> {
  const base = slugify(titleVi) || "khoa-hoc";
  let candidate = base;
  for (let n = 2; await courseUrlSlugTaken(sql, candidate, null); n++) candidate = withSuffix(base, n);
  return candidate;
}

export async function categoryUrlSlugTaken(sql: Sql, urlSlug: string, categoryId: string | null): Promise<boolean> {
  if (urlSlug === OTHER_CATEGORY_URL_SLUG) return true;
  const rows = await sql.query(`SELECT 1 AS hit FROM course_categories WHERE url_slug = $1 AND id IS DISTINCT FROM $2::uuid`, [urlSlug, categoryId]);
  return rows.length > 0;
}

/** Đường dẫn cho danh mục mới (một không gian phẳng cho cả danh mục con). Người gọi giữ khóa anh em/danh mục. */
export async function freeCategoryUrlSlug(sql: Sql, titleVi: string): Promise<string> {
  const base = slugify(titleVi) || "danh-muc";
  let candidate = base;
  for (let n = 2; await categoryUrlSlugTaken(sql, candidate, null); n++) candidate = withSuffix(base, n);
  return candidate;
}
