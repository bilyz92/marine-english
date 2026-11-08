import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { prisma, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { mergeGroupIds } from "@/modules/enrollments/access";
import type { LearnerCtx } from "@/modules/sessions/guards";

// Mật khẩu tạm của khách mua không cần đăng nhập (chủ 09/11/2026, docs/superpowers/plans/2026-11-09-checkout-credentials.md):
// không hiện ở bước 1; hiện ở bước 3 và gửi email khi thanh toán xong. Giữ dạng mã hóa AES-256-GCM (khóa SESSION_ENC_KEYS,
// AAD gắn mã học viên nên không chép sang người khác được); mất khi mật khẩu đổi (trigger trên password_logins) hoặc sau 30 ngày.

const aad = (userId: string) => Buffer.from(`learner-credential|${userId}`);
export const PENDING_CREDENTIALS_DAYS = 30;

export function sealCredential(userId: string, password: string): string {
  const { SESSION_ENC_KEYS, SESSION_ENC_KEY_CURRENT: kid } = env();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", SESSION_ENC_KEYS.get(kid)!, nonce);
  cipher.setAAD(aad(userId));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", kid, ...[nonce, ciphertext, cipher.getAuthTag()].map((b) => b.toString("base64url"))].join(".");
}

/** Sai định dạng, kid lạ, bị sửa hoặc của người khác → null. */
export function openCredential(userId: string, sealed: string): string | null {
  const [version, kid, nonceB64, ctB64, tagB64, ...rest] = sealed.split(".");
  if (version !== "v1" || !kid || !nonceB64 || ctB64 === undefined || !tagB64 || rest.length) return null;
  const key = env().SESSION_ENC_KEYS.get(kid);
  const nonce = Buffer.from(nonceB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (!key || nonce.length !== 12 || tag.length !== 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(userId));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

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

/**
 * Bước 3: chỉ khi đơn thuộc nhóm tài khoản của người hỏi và đang ở bước 3 (đã báo chuyển khoản còn mở, hoặc đã thanh toán).
 * Mọi trường hợp khác trả null, không lộ đơn có tồn tại hay không.
 */
export async function credentialsForOrder(ctx: LearnerCtx, orderCode: string): Promise<{ phone: string; password: string } | null> {
  const group = await mergeGroupIds(null, ctx.userId);
  const [order] = await prisma().$queryRaw<{ ok: boolean }[]>`
    SELECT (o.status = 'paid' OR EXISTS (
      SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id AND e.revoked_at IS NULL)) AS ok
    FROM orders o WHERE o.code = ${orderCode.trim().toUpperCase()} AND o.user_id = ANY(${group}::uuid[])`;
  if (!order?.ok) return null;
  return readPendingCredentials(ctx.userId);
}
