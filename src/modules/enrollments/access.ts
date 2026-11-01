import { prisma, type Tx } from "@/lib/db";

// Quyền học chỉ đọc từ enrollments còn hiệu lực, theo nhóm gộp: tài khoản + mọi tài khoản đã gộp vào nó (đệ quy).

type Db = Tx | ReturnType<typeof prisma>;

export async function mergeGroupIds(db: Db | null, userId: string): Promise<string[]> {
  const rows = await (db ?? prisma()).$queryRaw<{ id: string }[]>`
    WITH RECURSIVE grp(id) AS (
      SELECT ${userId}::uuid
      UNION
      SELECT u.id FROM users u JOIN grp ON u.merged_into_id = grp.id
    )
    SELECT id FROM grp`;
  return rows.map((r) => r.id);
}

export async function hasActiveEnrollment(db: Db, userIds: string[], courseId: string): Promise<boolean> {
  const [row] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM enrollments WHERE user_id = ANY(${userIds}::uuid[]) AND course_id = ${courseId}::uuid AND revoked_at IS NULL
    ) AS ok`;
  return row!.ok;
}

export async function hasCourseAccess(userId: string, courseId: string): Promise<boolean> {
  return hasActiveEnrollment(prisma(), await mergeGroupIds(null, userId), courseId);
}

/** Học viên (theo nhóm gộp) đã có khóa mang mã này chưa; mã không tồn tại thì chưa. */
export async function hasCourseAccessBySlug(userId: string, slug: string): Promise<boolean> {
  const [course] = await prisma().$queryRaw<{ id: string }[]>`SELECT id FROM courses WHERE slug = ${slug}`;
  return course ? hasCourseAccess(userId, course.id) : false;
}

export type MyCourse = { slug: string; titleVi: string; sources: ("order" | "grant")[] };

/** Khóa học viên đang có quyền (theo nhóm gộp) và nguồn quyền. */
export async function listMyCourses(userId: string): Promise<MyCourse[]> {
  const rows = await prisma().$queryRaw<{ slug: string; title_vi: string; sources: ("order" | "grant")[] }[]>`
    SELECT c.slug, c.title_vi, array_agg(DISTINCT e.source ORDER BY e.source) AS sources
    FROM enrollments e JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ANY(${await mergeGroupIds(null, userId)}::uuid[]) AND e.revoked_at IS NULL
    GROUP BY c.slug, c.title_vi ORDER BY c.slug`;
  return rows.map((r) => ({ slug: r.slug, titleVi: r.title_vi, sources: r.sources }));
}
