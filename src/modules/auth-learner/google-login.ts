import type { Tx } from "@/lib/db";
import type { GoogleClaims } from "@/modules/auth-oidc/google";
import { canonicalizeEmail } from "@/modules/identity/email";
import { findUserIdByIdentity } from "./identities";

/**
 * Tìm học viên theo google sub; lần đầu (email đã xác minh) thì tạo user + identity google, và identity email nếu email
 * chưa thuộc ai. Hai callback cùng sub chạy song song: bên thua bỏ user vừa tạo (savepoint) và dùng user đã có.
 */
export async function resolveGoogleUser(tx: Tx, claims: GoogleClaims): Promise<string | null> {
  const existing = await findUserIdByIdentity(tx, "google", claims.sub);
  if (existing) return existing;
  const email = claims.emailVerified && claims.email ? canonicalizeEmail(claims.email) : null;
  if (!email) return null;

  await tx.$executeRaw`SAVEPOINT google_user`;
  const [user] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO users (display_name, rank) VALUES (${email.split("@")[0]!}, NULL) RETURNING id`;
  const inserted = await tx.$executeRaw`
    INSERT INTO user_identities (user_id, kind, value_canonical, verified_at)
    VALUES (${user!.id}::uuid, 'google', ${claims.sub}, now())
    ON CONFLICT (kind, value_canonical) DO NOTHING`;
  if (inserted === 0) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT google_user`;
    return findUserIdByIdentity(tx, "google", claims.sub);
  }
  await tx.$executeRaw`RELEASE SAVEPOINT google_user`;
  await tx.$executeRaw`
    INSERT INTO user_identities (user_id, kind, value_canonical, verified_at)
    VALUES (${user!.id}::uuid, 'email', ${email}, now())
    ON CONFLICT (kind, value_canonical) DO NOTHING`;
  return user!.id;
}
