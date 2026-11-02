import { randomToken } from "@/lib/crypto";
import { withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { audit, auditDenied } from "@/modules/audit/audit";
import { canonicalizeEmail } from "@/modules/identity/email";
import type { AdminLinkSender } from "@/modules/mail/contracts";
import { createSession, tokenHash } from "@/modules/sessions/sessions";

// Link đăng nhập quản trị: 15 phút, dùng một lần, chỉ cho email đang active hoặc lời mời còn hạn.
// Link trỏ tới trang /admin/dang-nhap; người dùng bấm nút mới tiêu thụ (trình quét thư không làm mất link).

export async function issueAdminLink(email: string, sender: AdminLinkSender): Promise<void> {
  const canonical = canonicalizeEmail(email);
  if (!canonical) return;
  const token = randomToken();
  const issued = await withTx(async (tx) => {
    const [admin] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM admin_users
      WHERE email_lower = ${canonical} AND (status = 'active' OR (status = 'invited' AND now() < invite_expires_at))`;
    if (!admin) return false;
    // Giới hạn theo admin (chống dội thư; bảng link không được xóa): chờ 60 giây, tối đa 10 link/24 giờ.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin-link:${admin.id}`}))`;
    const [recent] = await tx.$queryRaw<{ minute: number; day: number }[]>`
      SELECT count(*) FILTER (WHERE created_at > now() - interval '60 seconds')::int AS minute, count(*)::int AS day
      FROM admin_email_links WHERE admin_user_id = ${admin.id}::uuid AND created_at > now() - interval '24 hours'`;
    if (recent!.minute > 0 || recent!.day >= 10) return false;
    // Chỉ link mới nhất còn dùng được.
    await tx.$executeRaw`
      UPDATE admin_email_links SET invalidated_at = now()
      WHERE admin_user_id = ${admin.id}::uuid AND used_at IS NULL AND invalidated_at IS NULL`;
    await tx.$executeRaw`
      INSERT INTO admin_email_links (token_hash, admin_user_id, expires_at)
      VALUES (${tokenHash("admin", token)}, ${admin.id}::uuid, now() + interval '15 minutes')`;
    return true;
  });
  if (!issued) return;
  try {
    // Token nằm sau dấu # (không gửi lên máy chủ, không vào log truy cập); trang đọc ở trình duyệt rồi xóa khỏi thanh địa chỉ.
    await sender.sendAdminLink(canonical, `${env().APP_ORIGIN}/admin/dang-nhap#link=${token}`);
  } catch {
    // Phản hồi phải giống trường hợp email không có thật; người dùng gửi lại link.
  }
}

type Consumed = { session: { token: string; csrf: string } } | { deniedAdminId: string | null };

export async function consumeAdminLink(token: string): Promise<{ token: string; csrf: string } | null> {
  const hash = tokenHash("admin", token);
  const outcome = await withTx(async (tx): Promise<Consumed> => {
    const [link] = await tx.$queryRaw<{ admin_user_id: string }[]>`
      UPDATE admin_email_links SET used_at = now()
      WHERE token_hash = ${hash} AND purpose = 'login' AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > now()
      RETURNING admin_user_id`;
    if (!link) {
      const [known] = await tx.$queryRaw<{ admin_user_id: string }[]>`
        SELECT admin_user_id FROM admin_email_links WHERE token_hash = ${hash}`;
      return { deniedAdminId: known?.admin_user_id ?? null };
    }
    const adminId = link.admin_user_id;
    const [admin] = await tx.$queryRaw<{ status: string; invitable: boolean }[]>`
      SELECT status, (status = 'invited' AND now() < invite_expires_at) AS invitable FROM admin_users WHERE id = ${adminId}::uuid`;
    if (admin?.status !== "active" && !admin?.invitable) return { deniedAdminId: adminId };
    if (admin.invitable) await tx.$executeRaw`SELECT admin_activate(${adminId}::uuid)`;
    const session = await createSession(tx, { realm: "admin", adminId, authAt: new Date() });
    await audit(tx, { adminId, action: "admin_login", targetType: "admin_user", targetId: adminId, result: "ok", reason: "email_link" });
    return { session: { token: session.token, csrf: session.csrf } };
  });
  if ("session" in outcome) return outcome.session;
  if (outcome.deniedAdminId) {
    const id = outcome.deniedAdminId;
    await auditDenied({ adminId: id, action: "admin_login", targetType: "admin_user", targetId: id, reason: "email_link" });
  }
  return null;
}
