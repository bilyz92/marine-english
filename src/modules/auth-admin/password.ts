import { withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/modules/auth-learner/password-hash";
import type { AdminCtx } from "@/modules/sessions/guards";
import { createSession, isRecentAuth } from "@/modules/sessions/sessions";

// D3 (02/11/2026): quản trị đăng nhập bằng email + mật khẩu. Không tự tạo tài khoản: chỉ email đã được mời và đang hoạt động.
// Cùng cách làm như D2 của học viên: giữ trước một lượt thử dưới khóa, băm ngoài giao dịch, rồi mới vào.

const EMAIL_FAILS = 5;
const IP_FAILS = 20;
const COMMON = new Set(["12345678", "123456789", "1234567890", "password", "matkhau123", "matkhau", "11111111", "00000000", "88888888", "abc12345", "qwerty123", "12345678a", "admin123", "admin1234"]);

export type AdminPasswordProblem = "too_short" | "too_long" | "common" | "email";
export type AdminLoginResult = { kind: "ok"; token: string; csrf: string } | { kind: "invalid" | "locked" };

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** 8–128 ký tự, không là mật khẩu phổ biến, không là chính email hay phần trước @. */
export function adminPasswordProblem(password: string, email: string): AdminPasswordProblem | null {
  const length = [...password].length;
  if (length < 8) return "too_short";
  if (length > 128) return "too_long";
  if (COMMON.has(password.toLowerCase())) return "common";
  const e = normalizeEmail(email);
  if ([e, e.split("@")[0]].includes(password.trim().toLowerCase())) return "email";
  return null;
}

async function lockKeys(tx: Tx, ip: string, email: string): Promise<void> {
  // Cùng thứ tự với mọi luồng: IP rồi email, tránh khóa chéo.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adm-pw-ip:${ip}`}))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`adm-pw-email:${email}`}))`;
}

async function isLocked(tx: Tx, ip: string, email: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ip_fails: number; email_fails: number }[]>`
    SELECT
      (SELECT count(*) FROM admin_login_attempts WHERE ip = ${ip}::inet AND NOT ok AND at > now() - interval '15 minutes')::int AS ip_fails,
      (SELECT count(*) FROM admin_login_attempts a
        WHERE a.email_lower = ${email} AND NOT a.ok
          AND a.at > greatest(now() - interval '15 minutes', coalesce(
            (SELECT max(at) FROM admin_login_attempts WHERE email_lower = ${email} AND ok), '-infinity')))::int AS email_fails`;
  return row!.ip_fails >= IP_FAILS || row!.email_fails >= EMAIL_FAILS;
}

/** Email không có, chưa đặt mật khẩu, không đang hoạt động, hay sai mật khẩu đều trả `invalid` (vẫn tốn một lần băm, vẫn đếm lượt). */
export async function loginAdminWithPassword(input: { email: string; password: string; ip: string }): Promise<AdminLoginResult> {
  const email = normalizeEmail(input.email).slice(0, 320);
  const reserved = await withTx(async (tx) => {
    await lockKeys(tx, input.ip, email);
    if (await isLocked(tx, input.ip, email)) return null;
    const [row] = await tx.$queryRaw<{ admin_user_id: string; password_hash: string | null; status: string }[]>`
      SELECT u.id::text AS admin_user_id, p.password_hash, u.status
      FROM admin_users u LEFT JOIN admin_passwords p ON p.admin_user_id = u.id
      WHERE u.email_lower = ${email}`;
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO admin_login_attempts (email_lower, ip, ok) VALUES (${email}, ${input.ip}::inet, false) RETURNING id::text AS id`;
    return { attemptId: attempt!.id, row: row ?? null };
  });
  if (!reserved) return { kind: "locked" };
  const { row } = reserved;
  const usable = row && row.password_hash && row.status === "active";
  const ok = usable ? await verifyPassword(input.password, row.password_hash!) : (await burnPasswordCheck(input.password), false);
  if (!usable || !ok) {
    // Mọi lần sai đi cùng một đường (kể cả email không có), để thời gian trả lời không lộ email nào có trong danh sách.
    const id = row?.admin_user_id ?? null;
    await auditDenied({ adminId: id, action: "admin_login", targetType: "admin_user", targetId: id, reason: "password", ip: input.ip });
    return { kind: "invalid" };
  }
  return withTx(async (tx): Promise<AdminLoginResult> => {
    // Khóa dòng quản trị (cùng khóa với thao tác thu hồi) rồi mới kiểm: thu hồi song song thì hoặc chờ phiên này rồi
    // quét phiên, hoặc phiên này thấy đã thu hồi. Mật khẩu có thể vừa đổi trong lúc băm: chỉ vào khi vẫn y như lúc đọc.
    const [lock] = await tx.$queryRaw<{ active: boolean }[]>`SELECT admin_lock_if_active(${row.admin_user_id}::uuid) AS active`;
    const [current] = lock?.active
      ? await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT true AS ok FROM admin_passwords WHERE admin_user_id = ${row.admin_user_id}::uuid AND password_hash = ${row.password_hash} FOR UPDATE`
      : [];
    if (!current) return { kind: "invalid" };
    await tx.$executeRaw`UPDATE admin_login_attempts SET ok = true WHERE id = ${reserved.attemptId}::uuid`;
    const session = await createSession(tx, { realm: "admin", adminId: row.admin_user_id, authAt: new Date() });
    await audit(tx, { adminId: row.admin_user_id, action: "admin_login", targetType: "admin_user", targetId: row.admin_user_id, result: "ok", reason: "password", ip: input.ip });
    return { kind: "ok", token: session.token, csrf: session.csrf };
  });
}

/** Đặt hoặc đổi mật khẩu của chính mình: cần đăng nhập trong 10 phút gần đây; hủy mọi phiên quản trị khác. */
export async function setOwnAdminPassword(ctx: AdminCtx, password: string): Promise<{ kind: "ok" } | { kind: "weak"; problem: AdminPasswordProblem }> {
  if (!isRecentAuth(ctx.authAt)) {
    await auditDenied({ adminId: ctx.adminId, action: "admin_password_set", targetType: "admin_user", targetId: ctx.adminId, reason: "reauth_required", ip: ctx.ip });
    throw new HttpError(403, "reauth_required");
  }
  const [admin] = await withTx((tx) => tx.$queryRaw<{ email_lower: string }[]>`SELECT email_lower FROM admin_users WHERE id = ${ctx.adminId}::uuid`);
  if (!admin) throw new HttpError(404, "not_found");
  const problem = adminPasswordProblem(password, admin.email_lower);
  if (problem) return { kind: "weak", problem };
  const hash = await hashPassword(password);
  await withTx(async (tx) => {
    const [lock] = await tx.$queryRaw<{ active: boolean }[]>`SELECT admin_lock_if_active(${ctx.adminId}::uuid) AS active`;
    if (!lock?.active) throw new HttpError(403, "role");
    await tx.$executeRaw`
      INSERT INTO admin_passwords (admin_user_id, password_hash) VALUES (${ctx.adminId}::uuid, ${hash})
      ON CONFLICT (admin_user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`;
    await tx.$executeRaw`
      UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = ${ctx.adminId}::uuid AND id <> ${ctx.sessionId}::uuid AND revoked_at IS NULL`;
    await audit(tx, { adminId: ctx.adminId, action: "admin_password_set", targetType: "admin_user", targetId: ctx.adminId, result: "ok", ip: ctx.ip });
  });
  return { kind: "ok" };
}

export async function adminHasPassword(adminId: string): Promise<boolean> {
  const [row] = await withTx((tx) => tx.$queryRaw<{ ok: boolean }[]>`SELECT true AS ok FROM admin_passwords WHERE admin_user_id = ${adminId}::uuid`);
  return !!row;
}
