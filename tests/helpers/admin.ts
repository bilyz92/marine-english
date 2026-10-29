import { withTx } from "@/lib/db";
import type { AdminCtx } from "@/modules/sessions/guards";
import { createSession } from "@/modules/sessions/sessions";
import { sqlAsMigrator } from "./otp";

/** Tạo admin trực tiếp bằng me_migrator (me_app không ghi được admin_users). */
export async function insertAdmin(email: string, role: "owner" | "support" = "owner", status = "active"): Promise<string> {
  const { rows } = await sqlAsMigrator(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at)
     VALUES ($1, $2, $3, now(), now() + interval '7 days', CASE WHEN $3 = 'active' THEN now() END) RETURNING id`,
    [email, role, status],
  );
  return rows[0].id as string;
}

export async function adminSession(adminId: string) {
  return withTx((tx) => createSession(tx, { realm: "admin", adminId, authAt: new Date() }));
}

export async function ownerCtx(email = "chu@x.vn"): Promise<AdminCtx & { token: string }> {
  const adminId = await insertAdmin(email);
  const s = await adminSession(adminId);
  return { adminId, role: "owner", sessionId: s.sessionId, authAt: new Date(), ip: "10.0.0.1", token: s.token };
}

export async function adminRow(email: string) {
  const { rows } = await sqlAsMigrator(`SELECT * FROM admin_users WHERE email_lower = $1`, [email]);
  return rows[0] as
    | { id: string; role: string; status: string; invited_at: Date; invite_expires_at: Date; activated_at: Date | null }
    | undefined;
}

export async function auditRows(action?: string) {
  const { rows } = await sqlAsMigrator(
    `SELECT admin_user_id, action, target_id, result, reason FROM admin_audit_log ${action ? "WHERE action = $1" : ""} ORDER BY at`,
    action ? [action] : [],
  );
  return rows as { admin_user_id: string | null; action: string; target_id: string | null; result: string; reason: string | null }[];
}

/** Lùi hạn mời (giữ CHECK invite_expires_at = invited_at + 7 ngày). */
export async function ageInvite(email: string, ms: number) {
  await sqlAsMigrator(
    `UPDATE admin_users SET invited_at = invited_at - make_interval(secs => $2::double precision / 1000),
       invite_expires_at = invite_expires_at - make_interval(secs => $2::double precision / 1000)
     WHERE email_lower = $1`,
    [email, ms],
  );
}
