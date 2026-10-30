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
