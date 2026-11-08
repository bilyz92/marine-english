import { prisma } from "@/lib/db";
import { hasActiveEnrollment, mergeGroupIds } from "@/modules/enrollments/access";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { entitledCourses } from "./entitlements";
import { modulesFor } from "@/modules/content/modules";

// Manifest có phiên bản của một khóa: danh sách bài và tệp để tải về học offline.

export type Manifest = {
  courseId: string;
  slug: string;
  titleVi: string;
  versionId: string;
  /** Chỉ có quyền mở tạm (chưa xác nhận tiền): học online, chưa tải về máy. */
  provisional: boolean;
  /** Chủ đề của học liệu theo thứ tự (A1, A2…); rỗng thì danh sách bài là một danh sách phẳng. */
  topics: { id: string; titleVi: string }[];
  /** Module do chủ tạo (docs/superpowers/plans/2026-11-08-course-modules.md); rỗng thì hiện theo chủ đề như trước. */
  modules: { id: string; titleVi: string }[];
  lessons: {
    position: number; lessonVersionId: string; externalId: string; title: string; topic: string | null; moduleId: string | null; lessonType: "qa" | "essay";
    contentHash: string; isFreeTrial: boolean; status: "in_progress" | "completed" | null; completedActivities: string[];
  }[];
  assets: { assetId: string; lessonVersionId: string; role: string; mime: string; bytes: number; sha256: string; visibility: "public" | "protected"; url: string }[];
  totalBytes: number;
};

export async function courseManifest(ctx: LearnerCtx, slug: string): Promise<Manifest | "forbidden" | "not_found"> {
  const db = prisma();
  const [course] = await db.$queryRaw<{ id: string; title_vi: string; current_version_id: string | null; topics: { id: string; titleVi: string }[] }[]>`
    SELECT id, title_vi, current_version_id, topics FROM courses WHERE slug = ${slug}`;
  if (!course?.current_version_id) return "not_found";
  if (!(await hasActiveEnrollment(db, await mergeGroupIds(db, ctx.userId), course.id))) return "forbidden";

  const lessons = await db.$queryRaw<
    {
      position: number; lesson_version_id: string; lesson_id: string; external_id: string; title: string | null; module_id: string | null; lesson_type: string | null; content_hash: string; is_free_trial: boolean;
      status: "in_progress" | "completed" | null; completed_activities: string[] | null;
    }[]
  >`
    SELECT cvl.position, cvl.lesson_version_id, l.external_id, cvl.is_free_trial, lv.content_hash, lp.status, lp.completed_activities,
           lv.content ->> 'module_id' AS module_id, lv.content ->> 'lesson_type' AS lesson_type, l.id::text AS lesson_id,
           coalesce(lv.content #>> '{question,text,vi}', lv.content #>> '{question,text,en}') AS title
    FROM course_version_lessons cvl
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
    JOIN lessons l ON l.id = lv.lesson_id
    LEFT JOIN learning_progress lp ON lp.lesson_id = l.id AND lp.user_id = ${ctx.userId}::uuid
    WHERE cvl.course_version_id = ${course.current_version_id}::uuid
    ORDER BY cvl.position`;
  const assets = await db.$queryRaw<
    { id: string; lesson_version_id: string; role: string; mime: string; bytes: number; sha256: string; visibility: "public" | "protected"; storage_key: string }[]
  >`
    SELECT ma.id, lva.lesson_version_id, lva.role, ma.mime, ma.bytes, ma.sha256, ma.visibility, ma.storage_key
    FROM lesson_version_assets lva
    JOIN media_assets ma ON ma.id = lva.media_asset_id
    JOIN course_version_lessons cvl ON cvl.lesson_version_id = lva.lesson_version_id
    WHERE cvl.course_version_id = ${course.current_version_id}::uuid
    ORDER BY cvl.position, ma.id`;
  // Một tệp dùng ở nhiều bài chỉ tải một lần.
  const bytesById = new Map(assets.map((a) => [a.id, a.bytes]));
  const topics = course.topics.map((t) => ({ id: t.id, titleVi: t.titleVi }));
  const { modules, lessonModule } = await modulesFor(db, course.id, course.current_version_id);
  const topicIds = new Set(topics.map((t) => t.id));
  return {
    courseId: course.id,
    slug,
    titleVi: course.title_vi,
    versionId: course.current_version_id,
    topics,
    modules,
    provisional: (await entitledCourses(ctx.userId, db)).find((c) => c.courseId === course.id)?.provisional ?? false,
    lessons: lessons.map((l) => ({
      position: l.position, lessonVersionId: l.lesson_version_id, externalId: l.external_id,
      title: l.title ?? l.external_id, topic: l.module_id && topicIds.has(l.module_id) ? l.module_id : null,
      moduleId: lessonModule.get(l.lesson_id) ?? null, lessonType: l.lesson_type === "essay" ? "essay" : "qa", contentHash: l.content_hash, isFreeTrial: l.is_free_trial,
      status: l.status, completedActivities: l.completed_activities ?? [],
    })),
    // Tệp công khai tải theo đường dẫn ổn định (Caddy phục vụ ở production); tệp bảo vệ chỉ qua API có kiểm quyền.
    assets: assets.map((a) => ({
      assetId: a.id, lessonVersionId: a.lesson_version_id, role: a.role, mime: a.mime, bytes: a.bytes, sha256: a.sha256, visibility: a.visibility,
      url: a.visibility === "public" ? `/media/${a.storage_key}` : `/api/learn/files/${a.id}`,
    })),
    totalBytes: [...bytesById.values()].reduce((sum, b) => sum + b, 0),
  };
}
