import { withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { revokeAllForSubject } from "@/modules/sessions/sessions";
import { mergeGroupIds } from "./access";

// Gộp tài khoản (DG §4): chuyển định danh sang tài khoản đích, khóa tài khoản nguồn và trỏ về đích, thu hồi phiên/thiết bị.
// Không sửa lịch sử (đơn, quyền học, hoàn tiền vẫn gắn tài khoản gốc); quyền học đọc theo nhóm gộp. Tiến độ học: P3.

export type MergePreview = { identities: { kind: string; value: string }[]; activeEnrollments: number; orders: number };

export async function mergeAccounts(
  ctx: AdminCtx,
  input: { sourceUserId: string; targetUserId: string; reason: string; preview: boolean },
): Promise<MergePreview | "merged" | "invalid"> {
  await authorize(ctx, "accounts.merge", { action: "account_merge", resource: { type: "user", id: input.sourceUserId } });
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Cần lý do gộp tài khoản");
  const { sourceUserId: source, targetUserId: target } = input;
  if (source === target) return "invalid";
  return withTx(async (tx) => {
    const users = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status FROM users WHERE id = ANY(${[source, target]}::uuid[]) ORDER BY id FOR UPDATE`;
    if (users.length !== 2 || users.some((u) => u.status !== "active")) return "invalid";

    const group = await mergeGroupIds(tx, source);
    const identities = await tx.$queryRaw<{ kind: string; value_canonical: string }[]>`
      SELECT kind, value_canonical FROM user_identities WHERE user_id = ${source}::uuid ORDER BY kind, value_canonical`;
    const [stats] = await tx.$queryRaw<{ enrollments: number; orders: number }[]>`
      SELECT (SELECT count(*) FROM enrollments WHERE user_id = ANY(${group}::uuid[]) AND revoked_at IS NULL)::int AS enrollments,
             (SELECT count(*) FROM orders WHERE user_id = ANY(${group}::uuid[]))::int AS orders`;
    const preview: MergePreview = {
      identities: identities.map((i) => ({ kind: i.kind, value: i.value_canonical })),
      activeEnrollments: stats!.enrollments,
      orders: stats!.orders,
    };
    if (input.preview) return preview;

    await tx.$executeRaw`UPDATE user_identities SET user_id = ${target}::uuid WHERE user_id = ${source}::uuid`;
    await tx.$executeRaw`UPDATE users SET status = 'merged', merged_into_id = ${target}::uuid WHERE id = ${source}::uuid`;
    await revokeAllForSubject(tx, "learner", source);
    await tx.$executeRaw`UPDATE devices SET revoked_at = now() WHERE user_id = ${source}::uuid AND revoked_at IS NULL`;
    await audit(tx, {
      adminId: ctx.adminId, action: "account_merge", targetType: "user", targetId: target,
      before: { sourceUserId: source }, after: { ...preview, mergedInto: target }, result: "ok", reason, ip: ctx.ip,
    });
    return "merged";
  });
}
