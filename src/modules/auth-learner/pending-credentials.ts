import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma, type Tx } from "@/lib/db";
import { env } from "@/lib/env";

// Mật khẩu tạm của khách mua không cần đăng nhập (chủ 09/11/2026; từ 16/11/2026 tài khoản tạo lúc nhận tiền, mật khẩu chỉ gửi qua
// email: docs/superpowers/plans/2026-11-16-guest-orders.md). Giữ dạng mã hóa AES-256-GCM (khóa SESSION_ENC_KEYS,
// AAD gắn mã học viên nên không chép sang người khác được); mất khi mật khẩu đổi (trigger trên password_logins) hoặc sau 30 ngày.

const aad = (userId: string) => Buffer.from(`learner-credential|${userId}`);
/** Mật khẩu tạm của đơn khách (chưa có học viên): gắn với mã đơn, niêm phong lại theo học viên khi nhận tiền. */
const guestAad = (orderId: string) => Buffer.from(`guest-order|${orderId}`);
export const PENDING_CREDENTIALS_DAYS = 30;

function seal(aadBytes: Buffer, password: string): string {
  const { SESSION_ENC_KEYS, SESSION_ENC_KEY_CURRENT: kid } = env();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SESSION_ENC_KEYS.get(kid)!, nonce);
  cipher.setAAD(aadBytes);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", kid, ...[nonce, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64url"))].join(".");
}

/** Sai định dạng, kid lạ, bị sửa hoặc khác chỗ gắn (AAD) → null. */
function open(aadBytes: Buffer, sealed: string): string | null {
  const [version, kid, nonceB64, ctB64, tagB64, ...rest] = sealed.split(".");
  if (version !== "v1" || !kid || !nonceB64 || ctB64 === undefined || !tagB64 || rest.length) return null;
  const key = env().SESSION_ENC_KEYS.get(kid);
  const nonce = Buffer.from(nonceB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (!key || nonce.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aadBytes);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const sealCredential = (userId: string, password: string) => seal(aad(userId), password);
/** Sai định dạng, kid lạ, bị sửa hoặc của người khác → null. */
export const openCredential = (userId: string, sealed: string) => open(aad(userId), sealed);
export const sealGuestPassword = (orderId: string, password: string) => seal(guestAad(orderId), password);
export const openGuestPassword = (orderId: string, sealed: string) => open(guestAad(orderId), sealed);

export async function savePendingCredentials(tx: Tx, userId: string, password: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO learner_pending_credentials (user_id, password_enc) VALUES (${userId}::uuid, ${sealCredential(userId, password)})`;
}

/** Số điện thoại (dạng 0…) và mật khẩu tạm còn hiệu lực của học viên; không có hoặc quá 30 ngày → null. */
export async function readPendingCredentials(userId: string): Promise<{ phone: string; password: string } | null> {
  const [row] = await prisma().$queryRaw<{ password_enc: string; phone_canonical: string }[]>`
    SELECT p.password_enc, l.phone_canonical FROM learner_pending_credentials p
    JOIN password_logins l ON l.user_id = p.user_id AND l.released_at IS NULL AND l.must_change
    WHERE p.user_id = ${userId}::uuid AND p.created_at > now() - make_interval(days => ${PENDING_CREDENTIALS_DAYS})`;
  if (!row) return null;
  const password = openCredential(userId, row.password_enc);
  return password ? { phone: `0${row.phone_canonical.slice(3)}`, password } : null;
}

export async function markCredentialsEmailed(userId: string): Promise<void> {
  await prisma().$executeRaw`UPDATE learner_pending_credentials SET emailed_at = now() WHERE user_id = ${userId}::uuid AND emailed_at IS NULL`;
}

/** Dọn bản chờ quá hạn (job hằng ngày). */
export async function prunePendingCredentials(): Promise<number> {
  return prisma().$executeRaw`
    DELETE FROM learner_pending_credentials WHERE created_at <= now() - make_interval(days => ${PENDING_CREDENTIALS_DAYS})`;
}
