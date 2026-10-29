import type { Tx } from "@/lib/db";
import type { GoogleClaims } from "@/modules/auth-oidc/google";
import { canonicalizeEmail } from "@/modules/identity/email";

/**
 * Admin theo Google: đã gắn sub → admin đó (phải active). Chưa gắn → email đã xác minh phải khớp admin active hoặc lời mời
 * còn hạn; gắn sub (mỗi admin một sub, mỗi sub một admin) rồi kích hoạt lời mời. Đổi email Google về sau không ảnh hưởng.
 */
export async function resolveGoogleAdmin(tx: Tx, claims: GoogleClaims): Promise<string | null> {
  const [bySub] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT a.id, a.status FROM admin_identities i JOIN admin_users a ON a.id = i.admin_user_id
    WHERE i.google_sub = ${claims.sub}`;
  if (bySub) return bySub.status === "active" ? bySub.id : null;

  const email = claims.emailVerified && claims.email ? canonicalizeEmail(claims.email) : null;
  if (!email) return null;
  const [admin] = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status FROM admin_users
    WHERE email_lower = ${email} AND (status = 'active' OR (status = 'invited' AND now() < invite_expires_at))`;
  if (!admin) return null;
  const inserted = await tx.$executeRaw`
    INSERT INTO admin_identities (admin_user_id, google_sub) VALUES (${admin.id}::uuid, ${claims.sub}) ON CONFLICT DO NOTHING`;
  if (inserted === 0) {
    // Callback song song cùng sub đã gắn trước thì được; admin đã gắn sub khác thì từ chối.
    const [same] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM admin_identities WHERE admin_user_id = ${admin.id}::uuid AND google_sub = ${claims.sub}`;
    if (!same) return null;
  }
  if (admin.status === "invited") await tx.$executeRaw`SELECT admin_activate(${admin.id}::uuid)`;
  return admin.id;
}
