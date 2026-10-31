import { prisma, type Tx } from "@/lib/db";
import { mergeGroupIds } from "@/modules/enrollments/access";

// Quyền đọc nội dung học: đọc từ enrollments theo nhóm gộp, không suy ra từ đơn; có enrollment là được, kể cả khóa chưa mở bán
// (cấp không thu tiền để học thử nội bộ). Bài học thử mở cho mọi học viên khi thuộc phiên bản hiện hành của khóa đang bán.

type Db = Tx | ReturnType<typeof prisma>;

export type EntitledCourse = { courseId: string; slug: string; versionId: string };

export async function entitledCourses(userId: string, db: Db = prisma()): Promise<EntitledCourse[]> {
  const group = await mergeGroupIds(db, userId);
  const rows = await db.$queryRaw<{ id: string; slug: string; current_version_id: string }[]>`
    SELECT DISTINCT c.id, c.slug, c.current_version_id
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ANY(${group}::uuid[]) AND e.revoked_at IS NULL AND c.current_version_id IS NOT NULL
    ORDER BY c.slug`;
  return rows.map((r) => ({ courseId: r.id, slug: r.slug, versionId: r.current_version_id }));
}

/** Có đọc được phiên bản bài này không: thuộc khóa có quyền (mọi phiên bản của khóa), hoặc là bài học thử đang mở. */
export async function canReadLessonVersion(userId: string, lessonVersionId: string, db: Db = prisma()): Promise<boolean> {
  return canReadVersions(db, userId, [lessonVersionId]);
}

/** Tệp đọc được khi có ít nhất một phiên bản bài chứa nó đọc được. */
export async function canReadAsset(userId: string, assetId: string): Promise<boolean> {
  const rows = await prisma().$queryRaw<{ lesson_version_id: string }[]>`
    SELECT lesson_version_id FROM lesson_version_assets WHERE media_asset_id = ${assetId}::uuid`;
  return canReadVersions(prisma(), userId, rows.map((r) => r.lesson_version_id));
}

async function canReadVersions(db: Db, userId: string, versionIds: string[]): Promise<boolean> {
  if (versionIds.length === 0) return false;
  const group = await mergeGroupIds(db, userId);
  const [row] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM course_version_lessons cvl JOIN course_versions cv ON cv.id = cvl.course_version_id
      WHERE cvl.lesson_version_id = ANY(${versionIds}::uuid[]) AND (
        EXISTS (SELECT 1 FROM enrollments e
                WHERE e.course_id = cv.course_id AND e.user_id = ANY(${group}::uuid[]) AND e.revoked_at IS NULL)
        OR (cvl.is_free_trial AND EXISTS (SELECT 1 FROM courses c
                WHERE c.id = cv.course_id AND c.status = 'published' AND c.current_version_id = cv.id))
      )
    ) AS ok`;
  return row!.ok;
}
