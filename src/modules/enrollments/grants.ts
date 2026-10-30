import { withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";

// Cấp quyền học không thu tiền (học thử nội bộ, tặng, hỗ trợ): chỉ chủ, bắt buộc lý do, không bao giờ đụng tới đơn.

export async function grantCourse(
  ctx: AdminCtx,
  input: { userId: string; courseId: string; reason: string },
): Promise<{ result: "granted"; enrollmentId: string } | { result: "not_found" }> {
  await authorize(ctx, "grants.create", { action: "grant_create", resource: { type: "user", id: input.userId } });
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Cần lý do cấp quyền");
  return withTx(async (tx) => {
    const [ok] = await tx.$queryRaw<{ user: boolean; course: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM users WHERE id = ${input.userId}::uuid AND status = 'active') AS user,
             EXISTS (SELECT 1 FROM courses WHERE id = ${input.courseId}::uuid) AS course`;
    if (!ok!.user || !ok!.course) return { result: "not_found" as const };
    const [row] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by)
      VALUES (${input.userId}::uuid, ${input.courseId}::uuid, 'grant', ${reason}, ${ctx.adminId}::uuid) RETURNING id`;
    await audit(tx, {
      adminId: ctx.adminId, action: "grant_create", targetType: "enrollment", targetId: row!.id,
      after: { userId: input.userId, courseId: input.courseId }, result: "ok", reason, ip: ctx.ip,
    });
    return { result: "granted" as const, enrollmentId: row!.id };
  });
}

export async function revokeGrant(ctx: AdminCtx, enrollmentId: string, reason: string): Promise<"revoked" | "not_found"> {
  await authorize(ctx, "grants.create", { action: "grant_revoke", resource: { type: "enrollment", id: enrollmentId } });
  if (!reason.trim()) throw new HttpError(400, "Cần lý do thu hồi");
  return withTx(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE enrollments SET revoked_at = now(), revoked_reason = ${`grant_revoke: ${reason.trim()}`}
      WHERE id = ${enrollmentId}::uuid AND source = 'grant' AND revoked_at IS NULL`;
    if (updated === 0) return "not_found";
    await audit(tx, {
      adminId: ctx.adminId, action: "grant_revoke", targetType: "enrollment", targetId: enrollmentId,
      result: "ok", reason: reason.trim(), ip: ctx.ip,
    });
    return "revoked";
  });
}
