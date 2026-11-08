import { prisma, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";

// Module khóa học (chủ 08/11/2026, docs/superpowers/plans/2026-11-08-course-modules.md, Task 1): chủ tự tạo, đặt tên, sắp thứ tự
// và xếp bài vào module. Xếp theo lessons.id (không theo phiên bản), nên sửa bài trên web hay nhập lại học liệu vẫn giữ. Bài không còn
// trong phiên bản hiện tại của khóa thì dòng xếp được giữ (bài quay lại thì về module cũ) nhưng không tính, không hiện, không chặn xóa.

type Db = Tx | ReturnType<typeof prisma>;
type CourseRow = { id: string; current_version_id: string | null };

export const MODULE_TITLE_MAX = 120;

async function courseOf(db: Db, slug: string, lock = false): Promise<CourseRow> {
  const rows = lock
    ? await db.$queryRaw<CourseRow[]>`SELECT id::text AS id, current_version_id::text AS current_version_id FROM courses WHERE slug = ${slug} FOR UPDATE`
    : await db.$queryRaw<CourseRow[]>`SELECT id::text AS id, current_version_id::text AS current_version_id FROM courses WHERE slug = ${slug}`;
  if (!rows[0]) throw new HttpError(404, "not_found");
  return rows[0];
}

/** lessons.id của các bài trong phiên bản hiện tại của khóa. */
async function currentLessonIds(db: Db, versionId: string | null): Promise<string[]> {
  if (!versionId) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT lv.lesson_id::text AS id FROM course_version_lessons cvl JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
    WHERE cvl.course_version_id = ${versionId}::uuid ORDER BY cvl.position`;
  return rows.map((r) => r.id);
}

function cleanTitle(titleVi: string): string {
  const t = titleVi.trim().replace(/\s+/g, " ");
  if (!t || t.length > MODULE_TITLE_MAX) throw new HttpError(400, "Tên module cần 1–120 ký tự");
  return t;
}

/** Module của khóa và module của từng bài đang trong phiên bản hiện tại (dùng cho manifest, trang khóa, trang quản trị). */
export async function modulesFor(db: Db, courseId: string, versionId: string | null): Promise<{
  modules: { id: string; titleVi: string }[];
  lessonModule: Map<string, string>;
}> {
  const modules = await db.$queryRaw<{ id: string; title_vi: string }[]>`
    SELECT id::text AS id, title_vi FROM course_modules WHERE course_id = ${courseId}::uuid ORDER BY position`;
  const current = await currentLessonIds(db, versionId);
  const rows = current.length
    ? await db.$queryRaw<{ lesson_id: string; module_id: string }[]>`
        SELECT lesson_id::text AS lesson_id, module_id::text AS module_id FROM course_lesson_modules
        WHERE course_id = ${courseId}::uuid AND lesson_id = ANY(${current}::uuid[])`
    : [];
  return { modules: modules.map((m) => ({ id: m.id, titleVi: m.title_vi })), lessonModule: new Map(rows.map((r) => [r.lesson_id, r.module_id])) };
}

export async function listModules(ctx: AdminCtx, slug: string) {
  await authorize(ctx, "orders.view", { action: "module_list", resource: { type: "course", id: slug } });
  const db = prisma();
  const course = await courseOf(db, slug);
  const { modules, lessonModule } = await modulesFor(db, course.id, course.current_version_id);
  const rows = await db.$queryRaw<{ id: string; position: number }[]>`
    SELECT id::text AS id, position FROM course_modules WHERE course_id = ${course.id}::uuid`;
  const position = new Map(rows.map((r) => [r.id, r.position]));
  const counts = new Map<string, number>();
  for (const m of lessonModule.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
  return { modules: modules.map((m) => ({ ...m, position: position.get(m.id)!, lessonCount: counts.get(m.id) ?? 0 })) };
}

/** Module đầu tiên của khóa đã có bài: mọi bài đang có vào module đó (chủ: "bài cũ vào Module 1"). */
export async function createModule(ctx: AdminCtx, slug: string, titleVi: string): Promise<{ id: string }> {
  await authorize(ctx, "content.edit", { action: "module_create", resource: { type: "course", id: slug } });
  const title = cleanTitle(titleVi);
  return withTx(async (tx) => {
    const course = await courseOf(tx, slug, true);
    const [{ n }] = (await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM course_modules WHERE course_id = ${course.id}::uuid`) as [{ n: number }];
    const [created] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO course_modules (course_id, title_vi, position) VALUES (${course.id}::uuid, ${title}, ${n + 1}) RETURNING id::text AS id`;
    let assigned = 0;
    if (n === 0) {
      const lessons = await currentLessonIds(tx, course.current_version_id);
      for (const lessonId of lessons) {
        assigned += await tx.$executeRaw`
          INSERT INTO course_lesson_modules (course_id, lesson_id, module_id) VALUES (${course.id}::uuid, ${lessonId}::uuid, ${created!.id}::uuid)
          ON CONFLICT (course_id, lesson_id) DO NOTHING`;
      }
    }
    await audit(tx, {
      adminId: ctx.adminId, action: "module_create", targetType: "course_module", targetId: created!.id,
      after: { course: slug, titleVi: title, position: n + 1, assignedLessons: assigned }, result: "ok", ip: ctx.ip,
    });
    return { id: created!.id };
  });
}

async function moduleIn(tx: Tx, courseId: string, moduleId: string): Promise<{ title_vi: string; position: number }> {
  const [row] = await tx.$queryRaw<{ title_vi: string; position: number }[]>`
    SELECT title_vi, position FROM course_modules WHERE id = ${moduleId}::uuid AND course_id = ${courseId}::uuid FOR UPDATE`;
  if (!row) throw new HttpError(404, "not_found");
  return row;
}

export async function renameModule(ctx: AdminCtx, slug: string, moduleId: string, titleVi: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "module_rename", resource: { type: "course", id: slug } });
  const title = cleanTitle(titleVi);
  await withTx(async (tx) => {
    const course = await courseOf(tx, slug, true);
    const before = await moduleIn(tx, course.id, moduleId);
    if (before.title_vi === title) return;
    await tx.$executeRaw`UPDATE course_modules SET title_vi = ${title} WHERE id = ${moduleId}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "module_rename", targetType: "course_module", targetId: moduleId,
      before: { titleVi: before.title_vi }, after: { titleVi: title }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Đổi chỗ với module kề; đang ở đầu (lên) hay cuối (xuống) thì không làm gì. */
export async function moveModule(ctx: AdminCtx, slug: string, moduleId: string, direction: "up" | "down"): Promise<void> {
  await authorize(ctx, "content.edit", { action: "module_move", resource: { type: "course", id: slug } });
  await withTx(async (tx) => {
    const course = await courseOf(tx, slug, true);
    const me = await moduleIn(tx, course.id, moduleId);
    const target = direction === "up" ? me.position - 1 : me.position + 1;
    const [other] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM course_modules WHERE course_id = ${course.id}::uuid AND position = ${target} FOR UPDATE`;
    if (!other) return;
    await tx.$executeRaw`UPDATE course_modules SET position = ${me.position} WHERE id = ${other.id}::uuid`;
    await tx.$executeRaw`UPDATE course_modules SET position = ${target} WHERE id = ${moduleId}::uuid`;
    await audit(tx, {
      adminId: ctx.adminId, action: "module_move", targetType: "course_module", targetId: moduleId,
      before: { position: me.position }, after: { position: target }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Còn bài (trong phiên bản hiện tại) → 409. Dòng xếp của bài không còn trong khóa bị xóa cùng module. */
export async function deleteModule(ctx: AdminCtx, slug: string, moduleId: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "module_delete", resource: { type: "course", id: slug } });
  await withTx(async (tx) => {
    const course = await courseOf(tx, slug, true);
    const me = await moduleIn(tx, course.id, moduleId);
    const current = await currentLessonIds(tx, course.current_version_id);
    const [{ n }] = (await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM course_lesson_modules
      WHERE course_id = ${course.id}::uuid AND module_id = ${moduleId}::uuid AND lesson_id = ANY(${current}::uuid[])`) as [{ n: number }];
    if (n > 0) throw new HttpError(409, "module_not_empty");
    await tx.$executeRaw`DELETE FROM course_lesson_modules WHERE course_id = ${course.id}::uuid AND module_id = ${moduleId}::uuid`;
    await tx.$executeRaw`DELETE FROM course_modules WHERE id = ${moduleId}::uuid`;
    await tx.$executeRaw`UPDATE course_modules SET position = position - 1 WHERE course_id = ${course.id}::uuid AND position > ${me.position}`;
    await audit(tx, {
      adminId: ctx.adminId, action: "module_delete", targetType: "course_module", targetId: moduleId,
      before: { course: slug, titleVi: me.title_vi, position: me.position }, result: "ok", ip: ctx.ip,
    });
  });
}

/** Xếp bài (trong phiên bản hiện tại của khóa) vào module của chính khóa đó. */
export async function setLessonModule(ctx: AdminCtx, slug: string, externalId: string, moduleId: string): Promise<void> {
  await authorize(ctx, "content.edit", { action: "lesson_module_set", resource: { type: "course", id: slug } });
  await withTx(async (tx) => {
    const course = await courseOf(tx, slug, true);
    await moduleIn(tx, course.id, moduleId);
    await assignLesson(tx, { ctx, slug, courseId: course.id, versionId: course.current_version_id, externalId, moduleId });
  });
}

/** Dùng chung cho xếp bài và thêm bài có module (Task 2). Người gọi đã khóa khóa học và kiểm module thuộc khóa. */
export async function assignLesson(tx: Tx, input: { ctx: AdminCtx; slug: string; courseId: string; versionId: string | null; externalId: string; moduleId: string }): Promise<void> {
  const [lesson] = input.versionId
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT l.id::text AS id FROM course_version_lessons cvl JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
        WHERE cvl.course_version_id = ${input.versionId}::uuid AND l.external_id = ${input.externalId}`
    : [];
  if (!lesson) throw new HttpError(404, "not_found");
  const [before] = await tx.$queryRaw<{ module_id: string }[]>`
    SELECT module_id::text AS module_id FROM course_lesson_modules WHERE course_id = ${input.courseId}::uuid AND lesson_id = ${lesson.id}::uuid`;
  if (before?.module_id === input.moduleId) return;
  await tx.$executeRaw`
    INSERT INTO course_lesson_modules (course_id, lesson_id, module_id) VALUES (${input.courseId}::uuid, ${lesson.id}::uuid, ${input.moduleId}::uuid)
    ON CONFLICT (course_id, lesson_id) DO UPDATE SET module_id = EXCLUDED.module_id`;
  await audit(tx, {
    adminId: input.ctx.adminId, action: "lesson_module_set", targetType: "lesson", targetId: `${input.slug}/${input.externalId}`,
    before: { moduleId: before?.module_id ?? null }, after: { moduleId: input.moduleId }, result: "ok", ip: input.ctx.ip,
  });
}
