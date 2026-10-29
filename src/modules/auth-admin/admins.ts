import { withTx } from "@/lib/db";
import { audit, auditDenied } from "@/modules/audit/audit";
import { canonicalizeEmail } from "@/modules/identity/email";
import type { AdminCtx } from "@/modules/sessions/guards";

// Mọi thay đổi admin_users đi qua hàm SQL SECURITY DEFINER (migration admin_owner_guard); me_app chỉ đọc bảng này.

export type AdminRole = "owner" | "support";
export type AdminStatus = "invited" | "active" | "expired" | "revoked";

function raisedBy(error: unknown, marker: string): boolean {
  return error instanceof Error && error.message.includes(marker);
}

export async function inviteAdmin(
  ctx: AdminCtx,
  input: { email: string; role: AdminRole },
): Promise<"invited" | "already_active" | "invalid_email"> {
  const email = canonicalizeEmail(input.email);
  if (!email) return "invalid_email";
  return withTx(async (tx) => {
    const [row] = await tx.$queryRaw<{ result: "invited" | "already_active" }[]>`
      SELECT admin_invite(${ctx.adminId}::uuid, ${email}, ${input.role}) AS result`;
    await audit(tx, {
      adminId: ctx.adminId, action: "admin_invite", targetType: "admin_user", targetId: email,
      after: { role: input.role, outcome: row!.result }, result: "ok", ip: ctx.ip,
    });
    return row!.result;
  });
}

export async function changeAdmin(
  ctx: AdminCtx,
  adminId: string,
  change: { role?: AdminRole; status?: AdminStatus },
): Promise<"ok" | "last_owner" | "not_owner"> {
  const entry = { adminId: ctx.adminId, action: "admin_change", targetType: "admin_user", targetId: adminId, after: change, ip: ctx.ip };
  try {
    await withTx(async (tx) => {
      const [before] = await tx.$queryRaw<{ role: string; status: string }[]>`
        SELECT role, status FROM admin_users WHERE id = ${adminId}::uuid`;
      await tx.$executeRaw`
        SELECT admin_change(${ctx.adminId}::uuid, ${adminId}::uuid, ${change.role ?? null}, ${change.status ?? null})`;
      await audit(tx, { ...entry, before, result: "ok" });
    });
    return "ok";
  } catch (error) {
    // not_owner: người thực hiện vừa mất quyền owner (ví dụ hai owner hạ quyền nhau cùng lúc).
    const denied = (["last_owner", "not_owner"] as const).find((marker) => raisedBy(error, marker));
    if (!denied) throw error;
    await auditDenied({ ...entry, reason: denied });
    return denied;
  }
}
