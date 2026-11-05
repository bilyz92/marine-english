import { randomInt } from "node:crypto";
import { withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx, LearnerCtx } from "@/modules/sessions/guards";
import { isRecentAuth, tokenHash } from "@/modules/sessions/sessions";
import { canonicalizeVnPhone } from "@/modules/identity/phone";
import { issueOtp, verifyOtp } from "./otp";
import { otpSenderFor } from "./otp-sender";
import { revokeAllForSubject } from "@/modules/sessions/sessions";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword, type PasswordProblem } from "./password-hash";

// D2: đăng ký và đăng nhập bằng số điện thoại + mật khẩu (docs/superpowers/plans/2026-11-01-phone-password.md).
// Số trong password_logins chưa xác minh; số đã xác minh (user_identities) luôn thắng.

const PHONE_FAILS = 5;
const IP_FAILS = 20;
const REGISTRATIONS_PER_IP_HOUR = 5;

const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

/**
 * Thứ tự khóa chung cho mọi đường đụng tới mật khẩu hay số (đăng nhập, đăng ký, đặt lại, đổi, chủ đặt tạm, gộp): dòng `users` (khi đã biết
 * học viên) → khóa tư vấn IP → khóa tư vấn số → dòng `password_logins`. Bước nào không cần thì bỏ, nhưng không bao giờ đảo thứ tự.
 */
async function lockActiveLearner(tx: Tx, userId: string): Promise<boolean> {
  const [user] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  return user?.status === "active";
}

async function lockKeys(tx: Tx, ip: string | null, phone: string | null): Promise<void> {
  if (ip) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pw-ip:${ip}`}))`;
  if (phone) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`phone:${phone}`}))`;
}

/**
 * Đang khóa: IP sai từ 20 lần trong 15 phút, hoặc số sai từ 5 lần trong 15 phút kể từ lần đúng gần nhất.
 * Tính theo bảng lượt thử, không theo tài khoản, nên số không có tài khoản bị khóa y hệt.
 */
async function isLocked(tx: Tx, ip: string, phone: string | null): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ip_fails: number; phone_fails: number }[]>`
    SELECT
      (SELECT count(*) FROM password_attempts
        WHERE ip = ${ip}::inet AND NOT ok AND kind IN ('login', 'current') AND at > now() - interval '15 minutes')::int AS ip_fails,
      (SELECT count(*) FROM password_attempts a
        WHERE a.phone_canonical = ${phone} AND NOT a.ok AND a.kind IN ('login', 'current')
          AND a.at > greatest(now() - interval '15 minutes', coalesce(
            (SELECT max(at) FROM password_attempts WHERE phone_canonical = ${phone} AND ok AND kind IN ('login', 'current')), '-infinity')))::int AS phone_fails`;
  return row!.ip_fails >= IP_FAILS || row!.phone_fails >= PHONE_FAILS;
}

async function emailTaken(tx: Tx, email: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ taken: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM user_identities WHERE kind = 'email' AND value_canonical = ${email}) AS taken`;
  return row!.taken;
}

/** Số đang có chủ: dòng mật khẩu chưa nhả của người khác, hoặc số đã xác minh của bất kỳ ai khác. */
async function phoneTaken(tx: Tx, phone: string, exceptUserId: string | null): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ taken: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM password_logins WHERE phone_canonical = ${phone} AND released_at IS NULL
                     AND user_id IS DISTINCT FROM ${exceptUserId}::uuid)
        OR EXISTS (SELECT 1 FROM user_identities WHERE kind = 'phone' AND value_canonical = ${phone}
                     AND user_id IS DISTINCT FROM ${exceptUserId}::uuid) AS taken`;
  return row!.taken;
}

/**
 * Sau mọi lần đổi mật khẩu hay gắn số (tự đổi, đặt lại qua email, chủ đặt tạm, đăng nhập bằng mật khẩu tạm, thêm số + mật khẩu): trong cùng
 * transaction thu hồi phiên, vé thay máy chưa dùng và mã đặt lại còn hiệu lực của học viên (trừ phiên đang dùng nếu có).
 */
async function revokeCredentials(tx: Tx, userId: string, keepSessionId?: string): Promise<void> {
  if (keepSessionId) {
    await tx.$executeRaw`
      UPDATE learner_sessions SET revoked_at = now(), prev_valid_until = NULL, next_token_enc = NULL
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL AND id <> ${keepSessionId}::uuid`;
  } else {
    await revokeAllForSubject(tx, "learner", userId);
  }
  await tx.$executeRaw`DELETE FROM login_tickets WHERE user_id = ${userId}::uuid AND used_at IS NULL`;
  await tx.$executeRaw`
    UPDATE otp_challenges SET invalidated_at = now()
    WHERE user_id = ${userId}::uuid AND purpose = 'reset' AND consumed_at IS NULL AND invalidated_at IS NULL`;
}

/** Ghi băm mới cho dòng đang có rồi thu hồi như `revokeCredentials`. */
export async function replacePassword(
  tx: Tx,
  userId: string,
  input: { hash: string; mustChange: boolean; keepSessionId?: string },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE password_logins SET password_hash = ${input.hash}, must_change = ${input.mustChange}, updated_at = now() WHERE user_id = ${userId}::uuid`;
  await revokeCredentials(tx, userId, input.keepSessionId);
}

/**
 * Gắn số (mới) + mật khẩu vào dòng của học viên: chưa có dòng thì tạo, dòng đã nhả thì dùng lại chỗ đó. Số học viên đã tự xác minh thì ghi
 * đã xác minh ngay. Người gọi đã khóa số và kiểm số chưa có chủ khác.
 */
async function attachPhone(tx: Tx, userId: string, phone: string, hash: string, mustChange: boolean): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO password_logins (user_id, phone_canonical, password_hash, must_change, phone_verified_at)
    VALUES (${userId}::uuid, ${phone}, ${hash}, ${mustChange},
            (SELECT now() FROM user_identities WHERE user_id = ${userId}::uuid AND kind = 'phone' AND value_canonical = ${phone}))
    ON CONFLICT (user_id) DO UPDATE SET
      phone_canonical = EXCLUDED.phone_canonical, password_hash = EXCLUDED.password_hash, must_change = EXCLUDED.must_change,
      phone_verified_at = EXCLUDED.phone_verified_at, released_at = NULL, updated_at = now()`;
}

export type RegisterResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "invalid_phone" | "phone_taken" | "email_taken" | "throttled" }
  | { kind: "weak"; problem: PasswordProblem };

/**
 * Tạo tài khoản bằng số + mật khẩu rồi chạy `then` (tạo phiên) trong cùng transaction. Băm tốn ~0,1 giây và 64 MB nên không được làm
 * trước khi kiểm hạn mức, cũng không được giữ kết nối DB hay khóa trong lúc băm: (1) transaction ngắn dưới khóa IP rồi số: kiểm hạn mức IP
 * (mọi lần đăng ký trong 1 giờ, kể cả lần hỏng) và số đã có chủ, rồi **giữ chỗ** một lượt đăng ký; (2) băm; (3) dưới khóa kiểm lại số rồi tạo.
 */
export async function registerWithPassword<T>(
  input: { phone: string; password: string; displayName: string; rank: string | null; ip: string; existingEmail?: string },
  then: (tx: Tx, userId: string) => Promise<T>,
): Promise<RegisterResult<T>> {
  const phone = canonicalizeVnPhone(input.phone);
  if (!phone) return { kind: "invalid_phone" };
  const problem = passwordProblem(input.password, phone);
  if (problem) return { kind: "weak", problem };
  const reserved = await withTx(async (tx): Promise<{ kind: "throttled" | "phone_taken" | "email_taken" } | { kind: "slot"; attemptId: string }> => {
    await lockKeys(tx, input.ip, phone);
    const [regs] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_attempts WHERE ip = ${input.ip}::inet AND kind = 'register' AND at > now() - interval '1 hour'`;
    if (regs!.n >= REGISTRATIONS_PER_IP_HOUR) return { kind: "throttled" };
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('register', ${input.ip}::inet, ${phone}, false) RETURNING id`;
    if (await phoneTaken(tx, phone, null)) return { kind: "phone_taken" };
    // Đăng ký nhanh ở trang mua: email khách nhập đã là email (đã xác minh) của tài khoản khác → mời đăng nhập tài khoản đó.
    if (input.existingEmail && (await emailTaken(tx, input.existingEmail))) return { kind: "email_taken" };
    return { kind: "slot", attemptId: attempt!.id };
  });
  if (reserved.kind !== "slot") return reserved;
  const hash = await hashPassword(input.password);
  return withTx(async (tx): Promise<RegisterResult<T>> => {
    await lockKeys(tx, input.ip, phone);
    if (await phoneTaken(tx, phone, null)) return { kind: "phone_taken" };
    const [user] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO users (display_name, rank) VALUES (${input.displayName}, ${input.rank}) RETURNING id`;
    await tx.$executeRaw`
      INSERT INTO password_logins (user_id, phone_canonical, password_hash) VALUES (${user!.id}::uuid, ${phone}, ${hash})`;
    await tx.$executeRaw`UPDATE password_attempts SET ok = true WHERE id = ${reserved.attemptId}::uuid`;
    return { kind: "ok", value: await then(tx, user!.id) };
  });
}

export type LoginResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "invalid" | "locked" | "set_password" }
  | { kind: "weak"; problem: PasswordProblem };

/**
 * Kiểm số + mật khẩu rồi chạy `then` (tạo phiên). Sai, số không có tài khoản hay sai dạng đều trả `invalid` (vẫn tốn một lần băm, vẫn
 * đếm lượt). Đang khóa thì không kiểm. Mật khẩu tạm (`must_change`): đúng mà chưa kèm mật khẩu mới → `set_password`; kèm mật khẩu mới
 * hợp lệ → đổi luôn rồi vào.
 *
 * Ba bước để không băm trong lúc giữ khóa: (1) transaction ngắn dưới khóa IP rồi số: kiểm khóa và **giữ trước** một lượt thử ghi là sai;
 * (2) băm ngoài transaction; (3) đúng thì đổi lượt đó thành đúng và vào, với điều kiện mật khẩu chưa đổi trong lúc kiểm.
 */
export async function loginWithPassword<T>(
  input: { phone: string; password: string; newPassword?: string; ip: string },
  then: (tx: Tx, userId: string) => Promise<T | null>,
): Promise<LoginResult<T>> {
  const phone = canonicalizeVnPhone(input.phone);
  const reserved = await withTx(async (tx) => {
    await lockKeys(tx, input.ip, phone);
    if (await isLocked(tx, input.ip, phone)) return null;
    const [row] = phone
      ? await tx.$queryRaw<{ user_id: string; password_hash: string; must_change: boolean }[]>`
          SELECT user_id, password_hash, must_change FROM password_logins WHERE phone_canonical = ${phone} AND released_at IS NULL`
      : [];
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('login', ${input.ip}::inet, ${phone}, false) RETURNING id`;
    return { attemptId: attempt!.id, row: row ?? null };
  });
  if (!reserved) return { kind: "locked" };
  const { row } = reserved;
  const ok = row ? await verifyPassword(input.password, row.password_hash) : (await burnPasswordCheck(input.password), false);
  if (!row || !ok) return { kind: "invalid" };
  // Mật khẩu tạm: chuẩn bị mật khẩu mới (băm) trước, ngoài transaction.
  const problem = row.must_change && input.newPassword ? passwordProblem(input.newPassword, phone!) : null;
  const newHash = row.must_change && input.newPassword && !problem ? await hashPassword(input.newPassword) : null;
  return withTx(async (tx): Promise<LoginResult<T>> => {
    if (!(await lockActiveLearner(tx, row.user_id))) return { kind: "invalid" };
    // Mật khẩu hay số có thể vừa đổi, vừa bị nhả trong lúc băm: chỉ vào khi dòng vẫn y như lúc đọc.
    const [current] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM password_logins
      WHERE user_id = ${row.user_id}::uuid AND phone_canonical = ${phone} AND released_at IS NULL AND password_hash = ${row.password_hash}
      FOR UPDATE`;
    if (!current) return { kind: "invalid" };
    // Mật khẩu đã đúng và dòng chưa đổi: lượt này là lượt đúng, kể cả khi còn phải đặt mật khẩu mới.
    await tx.$executeRaw`UPDATE password_attempts SET ok = true WHERE id = ${reserved.attemptId}::uuid`;
    if (row.must_change) {
      if (!input.newPassword) return { kind: "set_password" };
      if (problem) return { kind: "weak", problem };
      await replacePassword(tx, row.user_id, { hash: newHash!, mustChange: false });
    }
    const value = await then(tx, row.user_id);
    return value === null ? { kind: "invalid" } : { kind: "ok", value };
  });
}

/** Học viên đang giữ số (dòng chưa nhả) và email nhận mã đặt lại: email đã xác minh mới nhất (bằng nhau thì id nhỏ hơn). */
async function resetTarget(tx: Tx, phone: string): Promise<{ userId: string; email: string; hash: string } | null> {
  const [row] = await tx.$queryRaw<{ user_id: string; email: string; password_hash: string }[]>`
    SELECT p.user_id, e.value_canonical AS email, p.password_hash
    FROM password_logins p
    JOIN LATERAL (SELECT value_canonical FROM user_identities
                  WHERE user_id = p.user_id AND kind = 'email' ORDER BY verified_at DESC, id ASC LIMIT 1) e ON true
    WHERE p.phone_canonical = ${phone} AND p.released_at IS NULL`;
  return row ? { userId: row.user_id, email: row.email, hash: row.password_hash } : null;
}

/** Quên mật khẩu: có email liên kết thì gửi mã tới đó; không thì không làm gì. Người gọi luôn trả cùng một câu, không lộ email hay tài khoản. */
export async function sendPasswordReset(input: { phone: string; ip: string }): Promise<void> {
  const phone = canonicalizeVnPhone(input.phone);
  if (!phone) return;
  const target = await withTx((tx) => resetTarget(tx, phone));
  // Không có tài khoản hay email: vẫn đi qua cùng bước kiểm hạn mức và ghi nhật ký gửi, với một danh tính giả cố định theo số (HMAC,
  // không suy ngược được), không tạo mã, không gửi; để số có và không có tài khoản tốn công như nhau.
  const value = target?.email ?? `reset-${tokenHash("learner", phone).slice(0, 24)}@invalid.local`;
  await issueOtp({ purpose: "reset", kind: "email", value, ip: input.ip, userId: target?.userId, create: target !== null }, otpSenderFor("email"));
}

export type ResetResult<T> = { kind: "ok"; value: T } | { kind: "invalid" | "locked" } | { kind: "weak"; problem: PasswordProblem };

const RESET_FAILS_PER_IP = 20;

/**
 * Đặt mật khẩu mới bằng mã đặt lại. Mã chỉ hợp lệ cho đúng học viên đang giữ số và đúng email nhận mã (chọn lại theo cùng quy tắc).
 * Mật khẩu mới yếu thì báo trước, mã vẫn còn. Kiểm hạn mức IP (20 lần sai trong 15 phút, mọi số kể cả số không có tài khoản) và dùng mã
 * trong một transaction ngắn **trước** khi băm; băm ngoài transaction; rồi khóa học viên, đổi mật khẩu, thu hồi phiên, vé thay máy, mã
 * đặt lại khác, và chạy `then` (tạo phiên).
 */
export async function resetPasswordWithCode<T>(
  input: { phone: string; code: string; newPassword: string; ip: string },
  then: (tx: Tx, userId: string) => Promise<T | null>,
): Promise<ResetResult<T>> {
  const phone = canonicalizeVnPhone(input.phone);
  if (phone) {
    const problem = passwordProblem(input.newPassword, phone);
    if (problem) return { kind: "weak", problem };
  }
  const checked = await withTx(async (tx): Promise<{ kind: "invalid" | "locked" } | { kind: "ok"; userId: string; hash: string }> => {
    await lockKeys(tx, input.ip, phone);
    const [fails] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_attempts
      WHERE ip = ${input.ip}::inet AND kind = 'reset' AND NOT ok AND at > now() - interval '15 minutes'`;
    if (fails!.n >= RESET_FAILS_PER_IP) return { kind: "locked" };
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('reset', ${input.ip}::inet, ${phone}, false) RETURNING id`;
    const target = phone && /^\d{6}$/.test(input.code) ? await resetTarget(tx, phone) : null;
    if (!target) return { kind: "invalid" };
    const verified = await verifyOtp(tx, { purpose: "reset", kind: "email", value: target.email, code: input.code, userId: target.userId });
    if (verified !== "ok") return { kind: "invalid" };
    await tx.$executeRaw`UPDATE password_attempts SET ok = true WHERE id = ${attempt!.id}::uuid`;
    return { kind: "ok", userId: target.userId, hash: target.hash };
  });
  if (checked.kind !== "ok") return checked;
  const hash = await hashPassword(input.newPassword);
  return withTx(async (tx): Promise<ResetResult<T>> => {
    if (!(await lockActiveLearner(tx, checked.userId))) return { kind: "invalid" };
    // Mật khẩu có thể vừa đổi ở chỗ khác (chủ đặt tạm, học viên tự đổi) trong lúc băm: không ghi đè, mã đã dùng thì thôi.
    const [live] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM password_logins
      WHERE user_id = ${checked.userId}::uuid AND phone_canonical = ${phone} AND released_at IS NULL AND password_hash = ${checked.hash}
      FOR UPDATE`;
    if (!live) return { kind: "invalid" };
    await replacePassword(tx, checked.userId, { hash, mustChange: false });
    const value = await then(tx, checked.userId);
    return value === null ? { kind: "invalid" } : { kind: "ok", value };
  });
}

/**
 * Gọi ở mọi chỗ tạo danh tính số điện thoại đã xác minh. Số đã xác minh thắng: dòng mật khẩu chưa xác minh của học viên khác với số đó
 * bị nhả (đăng nhập bằng mật khẩu với số đó hết dùng được); của chính học viên thì ghi đã xác minh.
 */
export async function claimVerifiedPhone(tx: Tx, userId: string, phone: string): Promise<void> {
  await lockKeys(tx, null, phone);
  const released = await tx.$queryRaw<{ user_id: string; released_at: Date }[]>`
    UPDATE password_logins SET released_at = now(), updated_at = now()
    WHERE phone_canonical = ${phone} AND released_at IS NULL AND user_id <> ${userId}::uuid
    RETURNING user_id, released_at`;
  for (const r of released) {
    // Sự kiện hệ thống (không có quản trị viên làm): học viên mất cách đăng nhập bằng số này, hỗ trợ cần biết khi họ liên hệ.
    await audit(tx, {
      adminId: null, action: "password_login_released", targetType: "user", targetId: r.user_id, result: "ok",
      after: { phone: maskPhone(phone), reason: "verified_by_other" },
    });
  }
  await tx.$executeRaw`
    UPDATE password_logins SET phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now()
    WHERE user_id = ${userId}::uuid AND phone_canonical = ${phone} AND released_at IS NULL`;
}

export type ChangeResult =
  | { kind: "ok" }
  | { kind: "invalid_current" | "locked" | "reauth_required" | "phone_required" | "invalid_phone" | "phone_taken" | "inactive" }
  | { kind: "weak"; problem: PasswordProblem };

/**
 * Tài khoản của tôi. Có số + mật khẩu (dòng chưa nhả): đổi mật khẩu, cần mật khẩu hiện tại, kiểm qua cùng bảng lượt thử và cùng khóa như
 * đăng nhập. Chưa có hoặc đã bị nhả (tài khoản email/Google): thêm số + mật khẩu, cần đăng nhập gần đây. Xong thì thu hồi phiên khác,
 * vé thay máy và mã đặt lại; phiên đang dùng giữ nguyên.
 */
export async function changeOwnPassword(
  ctx: LearnerCtx,
  input: { currentPassword?: string; newPassword: string; phone?: string },
): Promise<ChangeResult> {
  const [row] = await withTx((tx) => tx.$queryRaw<{ phone_canonical: string; password_hash: string }[]>`
    SELECT phone_canonical, password_hash FROM password_logins WHERE user_id = ${ctx.userId}::uuid AND released_at IS NULL`);
  if (!row) return addPhoneAndPassword(ctx, input);

  const phone = row.phone_canonical;
  const problem = passwordProblem(input.newPassword, phone);
  if (problem) return { kind: "weak", problem };
  const attemptId = await withTx(async (tx) => {
    await lockKeys(tx, ctx.ip, phone);
    if (await isLocked(tx, ctx.ip, phone)) return null;
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('current', ${ctx.ip}::inet, ${phone}, false) RETURNING id`;
    return attempt!.id;
  });
  if (!attemptId) return { kind: "locked" };
  if (!(await verifyPassword(input.currentPassword ?? "", row.password_hash))) return { kind: "invalid_current" };
  const hash = await hashPassword(input.newPassword);
  return withTx(async (tx): Promise<ChangeResult> => {
    if (!(await lockActiveLearner(tx, ctx.userId))) return { kind: "inactive" };
    const [current] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM password_logins
      WHERE user_id = ${ctx.userId}::uuid AND released_at IS NULL AND password_hash = ${row.password_hash} FOR UPDATE`;
    if (!current) return { kind: "invalid_current" };
    await tx.$executeRaw`UPDATE password_attempts SET ok = true WHERE id = ${attemptId}::uuid`;
    await replacePassword(tx, ctx.userId, { hash, mustChange: false, keepSessionId: ctx.sessionId });
    return { kind: "ok" };
  });
}

async function addPhoneAndPassword(ctx: LearnerCtx, input: { newPassword: string; phone?: string }): Promise<ChangeResult> {
  if (!isRecentAuth(ctx.authAt)) return { kind: "reauth_required" };
  if (!input.phone) return { kind: "phone_required" };
  const phone = canonicalizeVnPhone(input.phone);
  if (!phone) return { kind: "invalid_phone" };
  const problem = passwordProblem(input.newPassword, phone);
  if (problem) return { kind: "weak", problem };
  const hash = await hashPassword(input.newPassword);
  return withTx(async (tx): Promise<ChangeResult> => {
    // Học viên có thể vừa bị gộp hay khóa: không gắn số vào tài khoản không còn hoạt động.
    if (!(await lockActiveLearner(tx, ctx.userId))) return { kind: "inactive" };
    await lockKeys(tx, ctx.ip, phone);
    const [live] = await tx.$queryRaw<{ ok: boolean }[]>`
      SELECT true AS ok FROM password_logins WHERE user_id = ${ctx.userId}::uuid AND released_at IS NULL FOR UPDATE`;
    // Vừa có dòng chưa nhả (thêm song song): đổi mật khẩu phải qua mật khẩu hiện tại.
    if (live) return { kind: "invalid_current" };
    if (await phoneTaken(tx, phone, ctx.userId)) return { kind: "phone_taken" };
    await attachPhone(tx, ctx.userId, phone, hash, false);
    await revokeCredentials(tx, ctx.userId, ctx.sessionId);
    return { kind: "ok" };
  });
}

// Mật khẩu tạm: 10 ký tự, bỏ các ký tự dễ nhầm khi đọc qua điện thoại (0/O, 1/I/l/L).
const TEMP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
/** Mật khẩu do hệ thống cấp (mật khẩu tạm của chủ, tài khoản tạo nhanh ở trang mua). */
export const generatedPassword = () => Array.from({ length: 10 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");

export type AdminResetResult = { kind: "ok"; temporaryPassword: string } | { kind: "not_found" | "no_password_login" | "invalid_phone" | "phone_taken" };

/**
 * Khôi phục qua hỗ trợ theo G15: chỉ chủ (xác thực lại gần đây), bắt buộc lý do và bằng chứng (mã đơn, giao dịch, hồ sơ). Đặt mật khẩu tạm
 * (phải đổi ở lần đăng nhập đầu), kèm `phone` thì gắn số mới chưa ai dùng. Thu hồi mọi phiên, vé thay máy, mã đặt lại; nhật ký không có mật khẩu.
 */
export async function adminResetPassword(
  ctx: AdminCtx,
  userId: string,
  input: { reason: string; evidence: string; phone?: string },
): Promise<AdminResetResult> {
  await authorize(ctx, "learners.password_reset", { action: "learner_password_reset", resource: { type: "user", id: userId } });
  const reason = input.reason.trim();
  const evidence = input.evidence.trim();
  if (!reason || !evidence) throw new HttpError(400, "Cần lý do và bằng chứng");
  const phone = input.phone ? canonicalizeVnPhone(input.phone) : null;
  const temp = generatedPassword();
  const hash = await hashPassword(temp);
  const result = await withTx(async (tx): Promise<AdminResetResult> => {
    const [user] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!user || user.status !== "active") return { kind: "not_found" };
    if (input.phone && !phone) return { kind: "invalid_phone" };
    let before: string | null = null;
    if (phone) {
      await lockKeys(tx, null, phone);
      if (await phoneTaken(tx, phone, userId)) return { kind: "phone_taken" };
      const [old] = await tx.$queryRaw<{ phone_canonical: string }[]>`SELECT phone_canonical FROM password_logins WHERE user_id = ${userId}::uuid`;
      before = old ? maskPhone(old.phone_canonical) : null;
      await attachPhone(tx, userId, phone, hash, true);
      await revokeCredentials(tx, userId);
    } else {
      const [live] = await tx.$queryRaw<{ phone_canonical: string }[]>`
        SELECT phone_canonical FROM password_logins WHERE user_id = ${userId}::uuid AND released_at IS NULL FOR UPDATE`;
      if (!live) return { kind: "no_password_login" };
      before = maskPhone(live.phone_canonical);
      await replacePassword(tx, userId, { hash, mustChange: true });
    }
    await audit(tx, {
      adminId: ctx.adminId, action: "learner_password_reset", targetType: "user", targetId: userId, result: "ok", reason, ip: ctx.ip,
      before: { phone: before }, after: { phone: phone ? maskPhone(phone) : before, newPhone: phone !== null, evidence, mustChange: true },
    });
    return { kind: "ok", temporaryPassword: temp };
  });
  if (result.kind !== "ok") {
    await auditDenied({ adminId: ctx.adminId, action: "learner_password_reset", targetType: "user", targetId: userId, reason: result.kind, ip: ctx.ip });
  }
  return result;
}

/** Cho trang Tài khoản của tôi: số đang dùng để đăng nhập bằng mật khẩu (chính học viên xem nên hiện đủ số). */
export async function myPasswordLogin(userId: string): Promise<{ phone: string; verified: boolean; released: boolean } | null> {
  const [row] = await withTx((tx) => tx.$queryRaw<{ phone_canonical: string; verified: boolean; released: boolean }[]>`
    SELECT phone_canonical, phone_verified_at IS NOT NULL AS verified, released_at IS NOT NULL AS released
    FROM password_logins WHERE user_id = ${userId}::uuid`);
  return row ? { phone: row.phone_canonical, verified: row.verified, released: row.released } : null;
}
