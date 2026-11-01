import { withTx, type Tx } from "@/lib/db";
import { audit } from "@/modules/audit/audit";
import { canonicalizeVnPhone } from "@/modules/identity/phone";
import { revokeAllForSubject } from "@/modules/sessions/sessions";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword, type PasswordProblem } from "./password-hash";

// D2: đăng ký và đăng nhập bằng số điện thoại + mật khẩu (docs/superpowers/plans/2026-11-01-phone-password.md).
// Số trong password_logins chưa xác minh; số đã xác minh (user_identities) luôn thắng.

const PHONE_FAILS = 5;
const IP_FAILS = 20;
const REGISTRATIONS_PER_IP_HOUR = 5;

const maskPhone = (phone: string) => `•••• ${phone.slice(-4)}`;

/** Thứ tự khóa chung cho mọi đường đụng tới mật khẩu hay số: IP trước, số sau (trong transaction của người gọi). */
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
 * Đổi mật khẩu (mọi đường: tự đổi, đặt lại qua email, chủ đặt tạm, đăng nhập bằng mật khẩu tạm): ghi băm mới, rồi trong cùng transaction
 * thu hồi phiên, vé thay máy chưa dùng và mã đặt lại còn hiệu lực của học viên (trừ phiên đang dùng nếu có).
 */
export async function replacePassword(
  tx: Tx,
  userId: string,
  input: { hash: string; mustChange: boolean; keepSessionId?: string },
): Promise<void> {
  await tx.$executeRaw`
    UPDATE password_logins SET password_hash = ${input.hash}, must_change = ${input.mustChange}, updated_at = now() WHERE user_id = ${userId}::uuid`;
  if (input.keepSessionId) {
    await tx.$executeRaw`
      UPDATE learner_sessions SET revoked_at = now(), prev_valid_until = NULL, next_token_enc = NULL
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL AND id <> ${input.keepSessionId}::uuid`;
  } else {
    await revokeAllForSubject(tx, "learner", userId);
  }
  await tx.$executeRaw`DELETE FROM login_tickets WHERE user_id = ${userId}::uuid AND used_at IS NULL`;
  await tx.$executeRaw`
    UPDATE otp_challenges SET invalidated_at = now()
    WHERE user_id = ${userId}::uuid AND purpose = 'reset' AND consumed_at IS NULL AND invalidated_at IS NULL`;
}

export type RegisterResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "invalid_phone" | "phone_taken" | "throttled" }
  | { kind: "weak"; problem: PasswordProblem };

/**
 * Tạo tài khoản bằng số + mật khẩu rồi chạy `then` (tạo phiên) trong cùng transaction. Băm tốn ~0,1 giây và 64 MB nên không được làm
 * trước khi kiểm hạn mức, cũng không được giữ kết nối DB hay khóa trong lúc băm: (1) transaction ngắn dưới khóa IP rồi số: kiểm hạn mức IP
 * (mọi lần đăng ký trong 1 giờ, kể cả lần hỏng) và số đã có chủ, rồi **giữ chỗ** một lượt đăng ký; (2) băm; (3) dưới khóa kiểm lại số rồi tạo.
 */
export async function registerWithPassword<T>(
  input: { phone: string; password: string; displayName: string; rank: string | null; ip: string },
  then: (tx: Tx, userId: string) => Promise<T>,
): Promise<RegisterResult<T>> {
  const phone = canonicalizeVnPhone(input.phone);
  if (!phone) return { kind: "invalid_phone" };
  const problem = passwordProblem(input.password, phone);
  if (problem) return { kind: "weak", problem };
  const reserved = await withTx(async (tx): Promise<{ kind: "throttled" | "phone_taken" } | { kind: "slot"; attemptId: string }> => {
    await lockKeys(tx, input.ip, phone);
    const [regs] = await tx.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM password_attempts WHERE ip = ${input.ip}::inet AND kind = 'register' AND at > now() - interval '1 hour'`;
    if (regs!.n >= REGISTRATIONS_PER_IP_HOUR) return { kind: "throttled" };
    const [attempt] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('register', ${input.ip}::inet, ${phone}, false) RETURNING id`;
    if (await phoneTaken(tx, phone, null)) return { kind: "phone_taken" };
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
