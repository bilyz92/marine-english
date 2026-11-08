import { prisma, withTx } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";

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

export async function listPublishedCourses(): Promise<CourseCard[]> {
  return group(await publishedRows()).map(({ lessons: _lessons, courseId: _courseId, ...card }) => card);
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

export async function listAllCourses() {
  return prisma().course.findMany({
    select: { id: true, slug: true, titleVi: true, status: true, priceVnd: true, updatedAt: true },
    orderBy: { slug: "asc" },
  });
}
