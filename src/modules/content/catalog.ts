import { prisma, withTx } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { publicMediaUrl } from "@/modules/storage/storage";

// Danh mục chỉ gồm khóa published; nội dung đọc theo phiên bản hiện hành của khóa.

type LessonSummary = { position: number; externalId: string; title: string; isFreeTrial: boolean; moduleId: string | null };
type TrialLesson = { position: number; externalId: string; title: string };
export type CourseCard = {
  slug: string;
  titleVi: string;
  titleEn: string;
  priceVnd: number;
  lessonCount: number;
  trialLessons: TrialLesson[];
};
/**
 * Trang khóa công khai (chủ 08/11/2026): người chưa mua chỉ thấy tên module và số bài; trong mỗi module chỉ bài học thử có tiêu đề,
 * bài khác chỉ còn con số, không gửi câu hỏi ra ngoài. Khóa chưa chia module: một nhóm "Nội dung khóa học".
 */
export type CourseModuleSummary = { id: string | null; titleVi: string; lessonCount: number; trial: TrialLesson[] };
export type CourseDetail = CourseCard & { modules: CourseModuleSummary[] };

type Row = {
  course_id: string; slug: string; title_vi: string; title_en: string; price_vnd: number;
  position: number; external_id: string; is_free_trial: boolean; title: string | null; module_id: string | null;
};

/** Tiêu đề bài: câu hỏi tiếng Việt, không có thì tiếng Anh, không có nữa thì mã bài. */
async function publishedRows(slug?: string): Promise<Row[]> {
  return prisma().$queryRaw<Row[]>`
    SELECT c.id::text AS course_id, c.slug, c.title_vi, c.title_en, c.price_vnd, cvl.position, l.external_id, cvl.is_free_trial,
           clm.module_id::text AS module_id, coalesce(lv.content #>> '{question,text,vi}', lv.content #>> '{question,text,en}') AS title
    FROM courses c
    JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
    JOIN lessons l ON l.id = lv.lesson_id
    LEFT JOIN course_lesson_modules clm ON clm.course_id = c.id AND clm.lesson_id = l.id
    WHERE c.status = 'published' AND (${slug ?? null}::text IS NULL OR c.slug = ${slug ?? null})
    ORDER BY c.slug, cvl.position`;
}

type Grouped = CourseCard & { courseId: string; lessons: LessonSummary[] };

function group(rows: Row[]): Grouped[] {
  const bySlug = new Map<string, Grouped>();
  for (const r of rows) {
    let course = bySlug.get(r.slug);
    if (!course) {
      course = { courseId: r.course_id, slug: r.slug, titleVi: r.title_vi, titleEn: r.title_en, priceVnd: r.price_vnd, lessonCount: 0, trialLessons: [], lessons: [] };
      bySlug.set(r.slug, course);
    }
    const lesson = { position: r.position, externalId: r.external_id, title: r.title ?? r.external_id, isFreeTrial: r.is_free_trial, moduleId: r.module_id };
    course.lessons.push(lesson);
    course.lessonCount += 1;
    if (r.is_free_trial) course.trialLessons.push({ position: lesson.position, externalId: lesson.externalId, title: lesson.title });
  }
  return [...bySlug.values()];
}

/** Danh mục của khóa trong danh sách công khai (chỉ danh sách; CourseCard và CourseDetail không đổi). */
export type CatalogCourseCard = CourseCard & {
  category: { id: string; titleVi: string; titleEn: string | null; parentTitleVi: string | null; parentTitleEn: string | null } | null;
};
/**
 * Nhóm khóa đang bán theo danh mục cấp 1 (docs/superpowers/plans/2026-11-14-course-categories.md, Task 2): khóa gắn thẳng ở `courses`,
 * khóa gắn danh mục con ở `subgroups`; `courseCount` và `minPriceVnd` tính cả hai. Nhóm không có khóa đang bán bị bỏ; khóa chưa có
 * danh mục ở nhóm cuối "Khóa khác" (key "khac").
 */
export type CatalogGroup = {
  id: string | null; key: string; titleVi: string; titleEn: string | null; imageUrl: string | null;
  courseCount: number; minPriceVnd: number; courses: CatalogCourseCard[];
  subgroups: { id: string; titleVi: string; courses: CatalogCourseCard[] }[];
};
export const OTHER_GROUP_KEY = "khac";

type CategoryRow = { id: string; parent_id: string | null; title_vi: string; title_en: string | null; storage_key: string | null };

export async function listPublishedCatalog(): Promise<{ courses: CatalogCourseCard[]; groups: CatalogGroup[] }> {
  const db = prisma();
  const [grouped, links, categories] = await Promise.all([
    publishedRows().then(group),
    db.$queryRaw<{ id: string; category_id: string | null }[]>`
      SELECT id::text AS id, category_id::text AS category_id FROM courses WHERE status = 'published'`,
    db.$queryRaw<CategoryRow[]>`
      SELECT c.id::text AS id, c.parent_id::text AS parent_id, c.title_vi, c.title_en, ma.storage_key
      FROM course_categories c LEFT JOIN course_categories p ON p.id = c.parent_id LEFT JOIN media_assets ma ON ma.id = c.image_asset_id
      ORDER BY coalesce(p.position, c.position), c.parent_id IS NOT NULL, c.position`,
  ]);
  const categoryOf = new Map(links.map((l) => [l.id, l.category_id]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const courses: CatalogCourseCard[] = [];
  const courseCategory = new Map<CatalogCourseCard, CategoryRow | undefined>();
  for (const { lessons: _lessons, courseId, ...card } of grouped) {
    const own = byId.get(categoryOf.get(courseId) ?? "");
    const parent = own?.parent_id ? byId.get(own.parent_id) : undefined;
    const course: CatalogCourseCard = {
      ...card,
      category: own
        ? { id: own.id, titleVi: own.title_vi, titleEn: own.title_en, parentTitleVi: parent?.title_vi ?? null, parentTitleEn: parent?.title_en ?? null }
        : null,
    };
    courses.push(course);
    courseCategory.set(course, own);
  }
  const inCategory = (id: string) => courses.filter((c) => courseCategory.get(c)?.id === id);
  const summarize = (base: Omit<CatalogGroup, "courseCount" | "minPriceVnd">): CatalogGroup => {
    const all = [...base.courses, ...base.subgroups.flatMap((s) => s.courses)];
    return { ...base, courseCount: all.length, minPriceVnd: Math.min(...all.map((c) => c.priceVnd)) };
  };
  const groups = categories
    .filter((c) => c.parent_id === null)
    .map((c) =>
      summarize({
        id: c.id, key: c.id, titleVi: c.title_vi, titleEn: c.title_en, imageUrl: c.storage_key ? publicMediaUrl(c.storage_key) : null,
        courses: inCategory(c.id),
        subgroups: categories
          .filter((s) => s.parent_id === c.id)
          .map((s) => ({ id: s.id, titleVi: s.title_vi, courses: inCategory(s.id) }))
          .filter((s) => s.courses.length > 0),
      }),
    )
    .filter((g) => g.courseCount > 0);
  const other = courses.filter((c) => !courseCategory.get(c));
  if (other.length) {
    groups.push(summarize({ id: null, key: OTHER_GROUP_KEY, titleVi: "Khóa khác", titleEn: null, imageUrl: null, courses: other, subgroups: [] }));
  }
  return { courses, groups };
}

export async function getPublishedCourse(slug: string): Promise<CourseDetail | null> {
  const course = group(await publishedRows(slug))[0];
  if (!course) return null;
  const { lessons, courseId, ...card } = course;
  const modules = await prisma().$queryRaw<{ id: string; title_vi: string }[]>`
    SELECT id::text AS id, title_vi FROM course_modules WHERE course_id = ${courseId}::uuid ORDER BY position`;
  const summary = (id: string | null, titleVi: string, own: LessonSummary[]): CourseModuleSummary => ({
    id, titleVi, lessonCount: own.length,
    trial: own.filter((l) => l.isFreeTrial).map(({ position, externalId, title }) => ({ position, externalId, title })),
  });
  if (modules.length === 0) return { ...card, modules: [summary(null, "Nội dung khóa học", lessons)] };
  const known = new Set(modules.map((m) => m.id));
  const groups = modules.map((m) => summary(m.id, m.title_vi, lessons.filter((l) => l.moduleId === m.id))).filter((g) => g.lessonCount > 0);
  const other = lessons.filter((l) => !l.moduleId || !known.has(l.moduleId));
  return { ...card, modules: other.length ? [...groups, summary(null, "Bài khác", other)] : groups };
}

/** Nội dung bài học thử: chỉ khi khóa published và vị trí là bài thử trong phiên bản hiện hành. */
export async function getTrialLesson(slug: string, position: number): Promise<{ externalId: string; content: unknown } | null> {
  if (!Number.isInteger(position) || position < 1) return null;
  const [row] = await prisma().$queryRaw<{ external_id: string; content: unknown }[]>`
    SELECT l.external_id, lv.content
    FROM courses c
    JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
    JOIN lessons l ON l.id = lv.lesson_id
    WHERE c.slug = ${slug} AND c.status = 'published' AND cvl.position = ${position} AND cvl.is_free_trial`;
  return row ? { externalId: row.external_id, content: row.content } : null;
}

export type CourseChange = { priceVnd?: number; status?: "draft" | "published" | "archived" };

/** Đổi giá/trạng thái (owner). Đơn đã tạo giữ giá trong ảnh chụp của đơn. */
export async function updateCourse(ctx: AdminCtx, courseId: string, change: CourseChange): Promise<"ok" | "not_found" | "needs_price"> {
  await authorize(ctx, "prices.edit", { action: "course_update", resource: { type: "course", id: courseId } });
  return withTx(async (tx) => {
    const [before] = await tx.$queryRaw<{ price_vnd: number | null; status: string; current_version_id: string | null }[]>`
      SELECT price_vnd, status, current_version_id FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`;
    if (!before) return "not_found";
    const after = { price_vnd: change.priceVnd ?? before.price_vnd, status: change.status ?? before.status };
    if (after.status === "published" && (after.price_vnd === null || before.current_version_id === null)) return "needs_price";
    await tx.$executeRaw`
      UPDATE courses SET price_vnd = ${after.price_vnd}, status = ${after.status}, updated_at = now() WHERE id = ${courseId}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "course_update", targetType: "course", targetId: courseId,
      before: { priceVnd: before.price_vnd, status: before.status }, after: { priceVnd: after.price_vnd, status: after.status },
      result: "ok", ip: ctx.ip,
    });
    return "ok";
  });
}

/**
 * Ngừng bán / mở bán tất cả (chủ 24/11/2026). Chỉ đổi published ↔ archived, nháp không đụng; mở bán bỏ qua khóa thiếu giá hoặc chưa có bài
 * (như updateCourse trả needs_price). Một transaction, mỗi khóa đổi một dòng audit course_update (reason "bulk").
 */
export async function bulkCourseStatus(ctx: AdminCtx, to: "published" | "archived"): Promise<{ changed: number; skipped: number }> {
  await authorize(ctx, "prices.edit", { action: "course_update", resource: { type: "course", id: "bulk" } });
  const from = to === "published" ? "archived" : "published";
  return withTx(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; price_vnd: number | null; current_version_id: string | null }[]>`
      SELECT id::text AS id, price_vnd, current_version_id FROM courses WHERE status = ${from} ORDER BY id FOR UPDATE`;
    let changed = 0;
    for (const row of rows) {
      if (to === "published" && (row.price_vnd === null || row.current_version_id === null)) continue;
      await tx.$executeRaw`UPDATE courses SET status = ${to}, updated_at = now() WHERE id = ${row.id}::uuid`;
      await audit(tx, {
        adminId: ctx.adminId, action: "course_update", targetType: "course", targetId: row.id,
        before: { priceVnd: row.price_vnd, status: from }, after: { priceVnd: row.price_vnd, status: to },
        result: "ok", reason: "bulk", ip: ctx.ip,
      });
      changed += 1;
    }
    return { changed, skipped: rows.length - changed };
  });
}

export async function listAllCourses() {
  return prisma().course.findMany({
    select: { id: true, slug: true, titleVi: true, status: true, priceVnd: true, updatedAt: true, categoryId: true },
    orderBy: { slug: "asc" },
  });
}
