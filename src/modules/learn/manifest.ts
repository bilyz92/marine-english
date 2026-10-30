import { prisma } from "@/lib/db";
import { hasActiveEnrollment, mergeGroupIds } from "@/modules/enrollments/access";
import type { LearnerCtx } from "@/modules/sessions/guards";

// Manifest có phiên bản của một khóa: danh sách bài và tệp để tải về học offline.

export type Manifest = {
  courseId: string;
  slug: string;
  versionId: string;
  lessons: { position: number; lessonVersionId: string; externalId: string; title: string; contentHash: string; isFreeTrial: boolean }[];
  assets: { assetId: string; lessonVersionId: string; role: string; mime: string; bytes: number; sha256: string }[];
  totalBytes: number;
};

export async function courseManifest(ctx: LearnerCtx, slug: string): Promise<Manifest | "forbidden" | "not_found"> {
  const db = prisma();
  const [course] = await db.$queryRaw<{ id: string; current_version_id: string | null }[]>`
    SELECT id, current_version_id FROM courses WHERE slug = ${slug}`;
  if (!course?.current_version_id) return "not_found";
  if (!(await hasActiveEnrollment(db, await mergeGroupIds(db, ctx.userId), course.id))) return "forbidden";

  const lessons = await db.$queryRaw<
    { position: number; lesson_version_id: string; external_id: string; title: string | null; content_hash: string; is_free_trial: boolean }[]
  >`
    SELECT cvl.position, cvl.lesson_version_id, l.external_id, cvl.is_free_trial, lv.content_hash,
           coalesce(lv.content #>> '{question,text,vi}', lv.content #>> '{question,text,en}') AS title
    FROM course_version_lessons cvl
    JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
    JOIN lessons l ON l.id = lv.lesson_id
    WHERE cvl.course_version_id = ${course.current_version_id}::uuid
    ORDER BY cvl.position`;
  const assets = await db.$queryRaw<{ id: string; lesson_version_id: string; role: string; mime: string; bytes: number; sha256: string }[]>`
    SELECT ma.id, lva.lesson_version_id, lva.role, ma.mime, ma.bytes, ma.sha256
    FROM lesson_version_assets lva
    JOIN media_assets ma ON ma.id = lva.media_asset_id
    JOIN course_version_lessons cvl ON cvl.lesson_version_id = lva.lesson_version_id
    WHERE cvl.course_version_id = ${course.current_version_id}::uuid
    ORDER BY cvl.position, ma.id`;
  // Một tệp dùng ở nhiều bài chỉ tải một lần.
  const bytesById = new Map(assets.map((a) => [a.id, a.bytes]));
  return {
    courseId: course.id,
    slug,
    versionId: course.current_version_id,
    lessons: lessons.map((l) => ({
      position: l.position, lessonVersionId: l.lesson_version_id, externalId: l.external_id,
      title: l.title ?? l.external_id, contentHash: l.content_hash, isFreeTrial: l.is_free_trial,
    })),
    assets: assets.map((a) => ({ assetId: a.id, lessonVersionId: a.lesson_version_id, role: a.role, mime: a.mime, bytes: a.bytes, sha256: a.sha256 })),
    totalBytes: [...bytesById.values()].reduce((sum, b) => sum + b, 0),
  };
}
