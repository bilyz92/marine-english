import { prisma, withTx, type Tx } from "@/lib/db";
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
/** Danh mục của khóa (chức danh, đối tượng học); danh mục con kèm tên danh mục cha. null = chưa xếp danh mục. */
export type CourseCategoryLabel = { titleVi: string; titleEn: string | null; parentTitleVi: string | null; parentTitleEn: string | null };
/** `description`: mô tả chủ soạn (chữ thuần, `## ` là tiêu đề, `* `/`- ` là gạch đầu dòng), null = chưa có. */
export type CourseDetail = CourseCard & { description: string | null; modules: CourseModuleSummary[] };

type Row = {
  course_id: string; slug: string; title_vi: string; title_en: string; price_vnd: number;
  position: number; external_id: string; is_free_trial: boolean; title: string | null; module_id: string | null;
};

/** Tiêu đề bài: câu hỏi tiếng Việt, không có thì tiếng Anh, không có nữa thì mã bài. */
async function publishedRows(slug?: string, db: Tx | ReturnType<typeof prisma> = prisma()): Promise<Row[]> {
  return db.$queryRaw<Row[]>`
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

/**
 * Thẻ khóa trong danh sách công khai (chỉ danh sách; CourseCard và CourseDetail không đổi). `comingSoon`: khóa 'archived' hiện là
 * "Sắp ra mắt" (chủ 25/11/2026): chỉ tên, danh mục, số bài; không giá (null), không bài học thử, không mua được.
 */
export type CatalogCourseCard = Omit<CourseCard, "priceVnd"> & {
  priceVnd: number | null;
  comingSoon: boolean;
  category: { id: string; titleVi: string; titleEn: string | null; parentTitleVi: string | null; parentTitleEn: string | null } | null;
};
/**
 * Nhóm khóa đang bán và sắp ra mắt theo danh mục cấp 1 (docs/superpowers/plans/2026-11-14-course-categories.md, Task 2): khóa gắn thẳng ở `courses`,
 * khóa gắn danh mục con ở `subgroups`; `courseCount` và `minPriceVnd` tính cả hai; `minPriceVnd` chỉ
 * tính khóa đang bán (null khi nhóm chỉ có khóa sắp ra mắt, lúc đó `comingSoon`). Nhóm không có khóa nào hiện được bị bỏ; khóa chưa có
 * danh mục ở nhóm cuối "Khóa khác" (key "khac").
 */
export type CatalogGroup = {
  id: string | null; key: string; titleVi: string; titleEn: string | null; imageUrl: string | null;
  courseCount: number; minPriceVnd: number | null; comingSoon: boolean; courses: CatalogCourseCard[];
  subgroups: { id: string; titleVi: string; courses: CatalogCourseCard[] }[];
};
export const OTHER_GROUP_KEY = "khac";

type CategoryRow = { id: string; parent_id: string | null; title_vi: string; title_en: string | null; storage_key: string | null };

type ComingSoonRow = { course_id: string; slug: string; title_vi: string; title_en: string; lesson_count: number };

/** Danh mục công khai: khóa đang bán và khóa sắp ra mắt ('archived'); khóa nháp không bao giờ có ở đây. */
export async function listPublishedCatalog(): Promise<{ courses: CatalogCourseCard[]; groups: CatalogGroup[] }> {
  // Một ảnh chụp dữ liệu cho mọi câu đọc: khóa đổi trạng thái giữa chừng không hiện hai lần hay mất (chủ 25/11/2026).
  const [grouped, soon, links, categories] = await prisma().$transaction(async (db) => [
    group(await publishedRows(undefined, db)),
    await db.$queryRaw<ComingSoonRow[]>`
      SELECT c.id::text AS course_id, c.slug, c.title_vi, c.title_en,
             (SELECT count(*)::int FROM course_version_lessons cvl WHERE cvl.course_version_id = c.current_version_id) AS lesson_count
      FROM courses c WHERE c.status = 'archived' ORDER BY c.slug`,
    await db.$queryRaw<{ id: string; category_id: string | null }[]>`
      SELECT id::text AS id, category_id::text AS category_id FROM courses WHERE status IN ('published', 'archived')`,
    await db.$queryRaw<CategoryRow[]>`
      SELECT c.id::text AS id, c.parent_id::text AS parent_id, c.title_vi, c.title_en, ma.storage_key
      FROM course_categories c LEFT JOIN course_categories p ON p.id = c.parent_id LEFT JOIN media_assets ma ON ma.id = c.image_asset_id
      ORDER BY coalesce(p.position, c.position), c.parent_id IS NOT NULL, c.position`,
  ] as const, { isolationLevel: "RepeatableRead" });
  const categoryOf = new Map(links.map((l) => [l.id, l.category_id]));
  const byId = new Map(categories.map((c) => [c.id, c]));
  const courses: CatalogCourseCard[] = [];
  const courseCategory = new Map<CatalogCourseCard, CategoryRow | undefined>();
  const cards: { courseId: string; card: Omit<CatalogCourseCard, "category"> }[] = [
    ...grouped.map(({ lessons: _lessons, courseId, ...card }) => ({ courseId, card: { ...card, comingSoon: false } })),
    ...soon.map((r) => ({
      courseId: r.course_id,
      card: { slug: r.slug, titleVi: r.title_vi, titleEn: r.title_en, priceVnd: null, lessonCount: r.lesson_count, trialLessons: [], comingSoon: true },
    })),
  // Khóa đang mở bán lên đầu, rồi tới khóa sắp ra mắt (chủ 25/11/2026); trong mỗi phần xếp theo mã khóa.
  ].sort((a, b) => Number(a.card.comingSoon) - Number(b.card.comingSoon) || (a.card.slug < b.card.slug ? -1 : a.card.slug > b.card.slug ? 1 : 0));
  for (const { courseId, card } of cards) {
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
  const summarize = (base: Omit<CatalogGroup, "courseCount" | "minPriceVnd" | "comingSoon">): CatalogGroup => {
    const all = [...base.courses, ...base.subgroups.flatMap((s) => s.courses)];
    const prices = all.flatMap((c) => (c.priceVnd === null ? [] : [c.priceVnd]));
    return { ...base, courseCount: all.length, minPriceVnd: prices.length ? Math.min(...prices) : null, comingSoon: prices.length === 0 };
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
          .filter((s) => s.courses.length > 0)
          .sort((a, b) => Number(a.courses.every((x) => x.comingSoon)) - Number(b.courses.every((x) => x.comingSoon))),
      }),
    )
    .filter((g) => g.courseCount > 0);
  const other = courses.filter((c) => !courseCategory.get(c));
  if (other.length) {
    groups.push(summarize({ id: null, key: OTHER_GROUP_KEY, titleVi: "Khóa khác", titleEn: null, imageUrl: null, courses: other, subgroups: [] }));
  }
  // Danh mục có khóa đang mở bán lên đầu; giữ thứ tự chủ đã xếp trong mỗi phần (sort ổn định).
  groups.sort((a, b) => Number(a.comingSoon) - Number(b.comingSoon));
  return { courses, groups };
}

export async function getPublishedCourse(slug: string): Promise<CourseDetail | null> {
  const course = group(await publishedRows(slug))[0];
  if (!course) return null;
  const { lessons, courseId, ...card } = course;
  const modules = await prisma().$queryRaw<{ id: string; title_vi: string }[]>`
    SELECT id::text AS id, title_vi FROM course_modules WHERE course_id = ${courseId}::uuid ORDER BY position`;
  const description = (await prisma().$queryRaw<{ description: string | null }[]>`SELECT description FROM courses WHERE id = ${courseId}::uuid`)[0]?.description ?? null;
  const summary = (id: string | null, titleVi: string, own: LessonSummary[]): CourseModuleSummary => ({
    id, titleVi, lessonCount: own.length,
    trial: own.filter((l) => l.isFreeTrial).map(({ position, externalId, title }) => ({ position, externalId, title })),
  });
  if (modules.length === 0) return { ...card, description, modules: [summary(null, "Nội dung khóa học", lessons)] };
  const known = new Set(modules.map((m) => m.id));
  const groups = modules.map((m) => summary(m.id, m.title_vi, lessons.filter((l) => l.moduleId === m.id))).filter((g) => g.lessonCount > 0);
  const other = lessons.filter((l) => !l.moduleId || !known.has(l.moduleId));
  return { ...card, description, modules: other.length ? [...groups, summary(null, "Bài khác", other)] : groups };
}

/**
 * Danh mục (chức danh) của một khóa đang bán, cho trang khóa (đối tượng học, mô tả SEO). Tách khỏi getPublishedCourse: API chi tiết
 * khóa công khai không trả trường category.
 */
export async function getPublishedCourseCategory(slug: string): Promise<CourseCategoryLabel | null> {
  const [cat] = await prisma().$queryRaw<{ title_vi: string; title_en: string | null; parent_title_vi: string | null; parent_title_en: string | null }[]>`
    SELECT cc.title_vi, cc.title_en, p.title_vi AS parent_title_vi, p.title_en AS parent_title_en
    FROM courses c JOIN course_categories cc ON cc.id = c.category_id LEFT JOIN course_categories p ON p.id = cc.parent_id
    WHERE c.slug = ${slug} AND c.status = 'published'`;
  return cat ? { titleVi: cat.title_vi, titleEn: cat.title_en, parentTitleVi: cat.parent_title_vi, parentTitleEn: cat.parent_title_en } : null;
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

/** `description`: null = xóa mô tả (route đã cắt khoảng trắng và đổi chuỗi rỗng thành null). */
export type CourseChange = { priceVnd?: number; status?: "draft" | "published" | "archived"; description?: string | null };

/** Đổi giá/trạng thái/mô tả (owner). Đơn đã tạo giữ giá trong ảnh chụp của đơn. Audit ghi mô tả chỉ khi lần này có đổi mô tả. */
export async function updateCourse(ctx: AdminCtx, courseId: string, change: CourseChange): Promise<"ok" | "not_found" | "needs_price"> {
  await authorize(ctx, "prices.edit", { action: "course_update", resource: { type: "course", id: courseId } });
  return withTx(async (tx) => {
    const [before] = await tx.$queryRaw<{ price_vnd: number | null; status: string; current_version_id: string | null; description: string | null }[]>`
      SELECT price_vnd, status, current_version_id, description FROM courses WHERE id = ${courseId}::uuid FOR UPDATE`;
    if (!before) return "not_found";
    const after = {
      price_vnd: change.priceVnd ?? before.price_vnd, status: change.status ?? before.status,
      description: change.description !== undefined ? change.description : before.description,
    };
    if (after.status === "published" && (after.price_vnd === null || before.current_version_id === null)) return "needs_price";
    await tx.$executeRaw`
      UPDATE courses SET price_vnd = ${after.price_vnd}, status = ${after.status}, description = ${after.description}, updated_at = now() WHERE id = ${courseId}::uuid`;
    const described = change.description !== undefined;
    await audit(tx, {
      adminId: ctx.adminId, action: "course_update", targetType: "course", targetId: courseId,
      before: { priceVnd: before.price_vnd, status: before.status, ...(described ? { description: before.description } : {}) },
      after: { priceVnd: after.price_vnd, status: after.status, ...(described ? { description: after.description } : {}) },
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
