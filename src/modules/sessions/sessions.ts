import { hmacHex, randomToken, safeEqualHex } from "@/lib/crypto";
import { now } from "@/lib/clock";
import { env } from "@/lib/env";
import { prisma, withTx, type Tx } from "@/lib/db";
import { csrfFor } from "./csrf";
import { openNextToken, sealNextToken } from "./envelope";

// Phiên tự quản lý (D1). Mọi mốc thời gian lấy now() của DB.
// Học viên: tuyệt đối 90 ngày, nhàn rỗi 37 ngày, xoay token khi ≥ 7 ngày, cửa sổ token cũ 2 phút,
// lịch sử token 37 ngày. Quản trị: tuyệt đối 12 giờ, nhàn rỗi 1 giờ, không xoay.

export type Realm = "learner" | "admin";

export type SessionView = {
  sessionId: string;
  subjectId: string;
  deviceId?: string;
  authAt: Date;
  reissue?: { token: string; csrf: string };
};

type CreateInput =
  | { realm: "learner"; userId: string; deviceId: string; authAt: Date }
  | { realm: "admin"; adminId: string; authAt: Date };

export class InactiveUserError extends Error {
  constructor() {
    super("Tài khoản học viên không còn hoạt động");
  }
}

const RECENT_AUTH_MS = 10 * 60_000;

/** HMAC của token (phiên, vé, khóa thiết bị) bằng khóa riêng của khu vực; DB chỉ lưu giá trị này. */
export function tokenHash(realm: Realm, token: string): string {
  const e = env();
  return hmacHex(Buffer.from(realm === "admin" ? e.SESSION_KEY_ADMIN : e.SESSION_KEY_LEARNER, "base64"), token);
}

export async function createSession(tx: Tx, input: CreateInput): Promise<{ sessionId: string; token: string; csrf: string }> {
  const token = randomToken();
  const hash = tokenHash(input.realm, token);
  let rows: { id: string }[];
  if (input.realm === "learner") {
    const [user] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM users WHERE id = ${input.userId}::uuid FOR SHARE`;
    if (user?.status !== "active") throw new InactiveUserError();
    rows = await tx.$queryRaw`
      INSERT INTO learner_sessions (user_id, device_id, token_hash, auth_at, absolute_expires_at)
      VALUES (${input.userId}::uuid, ${input.deviceId}::uuid, ${hash}, ${input.authAt}, now() + interval '90 days')
      RETURNING id`;
  } else {
    rows = await tx.$queryRaw`
      INSERT INTO admin_sessions (admin_user_id, token_hash, auth_at, absolute_expires_at)
      VALUES (${input.adminId}::uuid, ${hash}, ${input.authAt}, now() + interval '12 hours')
      RETURNING id`;
  }
  const sessionId = rows[0]!.id;
  return { sessionId, token, csrf: csrfFor(input.realm, sessionId) };
}

export async function validateSession(realm: Realm, token: string): Promise<SessionView | null> {
  const hash = tokenHash(realm, token);
  return realm === "admin" ? validateAdmin(hash) : validateLearner(hash);
}

async function validateAdmin(hash: string): Promise<SessionView | null> {
  const db = prisma();
  const [s] = await db.$queryRaw<{ id: string; admin_user_id: string; auth_at: Date }[]>`
    SELECT s.id, s.admin_user_id, s.auth_at
    FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token_hash = ${hash} AND s.revoked_at IS NULL AND a.status = 'active'
      AND now() < s.absolute_expires_at AND now() < s.last_seen_at + interval '1 hour'`;
  if (!s) return null;
  await db.$executeRaw`
    UPDATE admin_sessions SET last_seen_at = now()
    WHERE id = ${s.id}::uuid AND last_seen_at <= now() - interval '5 minutes'`;
  return { sessionId: s.id, subjectId: s.admin_user_id, authAt: s.auth_at };
}

type LearnerRow = { id: string; user_id: string; device_id: string; auth_at: Date };

async function validateLearner(hash: string): Promise<SessionView | null> {
  const db = prisma();
  const [s] = await db.$queryRaw<LearnerRow[]>`
    SELECT s.id, s.user_id, s.device_id, s.auth_at
    FROM learner_sessions s
    JOIN devices d ON d.id = s.device_id
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hash} AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND u.status = 'active'
      AND now() < s.absolute_expires_at AND now() < s.last_seen_at + interval '37 days'`;
  if (!s) return validateOldLearnerToken(hash);
  // Cập nhật last_seen_at khi đã ≥ 5 phút; xóa phong bì đã hết cửa sổ khi gặp.
  await db.$executeRaw`
    UPDATE learner_sessions SET
      last_seen_at = CASE WHEN last_seen_at <= now() - interval '5 minutes' THEN now() ELSE last_seen_at END,
      prev_valid_until = CASE WHEN prev_valid_until <= now() THEN NULL ELSE prev_valid_until END,
      next_token_enc = CASE WHEN prev_valid_until <= now() THEN NULL ELSE next_token_enc END
    WHERE id = ${s.id}::uuid AND (last_seen_at <= now() - interval '5 minutes' OR prev_valid_until <= now())`;
  // Hoạt động của phiên cũng là hoạt động của máy (job giải phóng máy và màn “Dùng lần cuối” đọc cột này).
  // Máy đang bị đồng bộ khóa thì bỏ qua: đồng bộ tự ghi, và request thường không phải chờ.
  await db.$executeRaw`
    UPDATE devices SET last_seen_at = now()
    WHERE id IN (
      SELECT id FROM devices
      WHERE id = ${s.device_id}::uuid AND (last_seen_at IS NULL OR last_seen_at <= now() - interval '5 minutes')
      FOR UPDATE SKIP LOCKED
    )`;
  return { sessionId: s.id, subjectId: s.user_id, deviceId: s.device_id, authAt: s.auth_at };
}

/**
 * Token cũ: nếu là token liền trước (dòng lịch sử mới nhất) và còn trong cửa sổ 2 phút thì cấp lại token hiện tại;
 * khớp bất kỳ dòng lịch sử nào khác còn hạn phát hiện → coi là bị đánh cắp, thu hồi cả phiên.
 */
async function validateOldLearnerToken(hash: string): Promise<SessionView | null> {
  return withTx(async (tx) => {
    const [hit] = await tx.$queryRaw<{ session_id: string }[]>`
      SELECT session_id FROM session_token_history WHERE token_hash = ${hash} AND detect_until > now()`;
    if (!hit) return null;
    const [s] = await tx.$queryRaw<
      (LearnerRow & { token_hash: string; next_token_enc: string | null; reusable: boolean; latest: string })[]
    >`
      SELECT s.id, s.user_id, s.device_id, s.auth_at, s.token_hash, s.next_token_enc,
        (s.revoked_at IS NULL AND d.revoked_at IS NULL AND u.status = 'active'
          AND now() < s.absolute_expires_at AND now() < s.last_seen_at + interval '37 days'
          AND s.prev_valid_until > now()) AS reusable,
        (SELECT h.token_hash FROM session_token_history h WHERE h.session_id = s.id
          ORDER BY h.rotated_at DESC LIMIT 1) AS latest
      FROM learner_sessions s
      JOIN devices d ON d.id = s.device_id
      JOIN users u ON u.id = s.user_id
      WHERE s.id = ${hit.session_id}::uuid
      FOR UPDATE OF s`;
    if (!s) return null;
    if (s.reusable && s.latest === hash && s.next_token_enc) {
      const current = openNextToken(s.next_token_enc, { realm: "learner", sessionId: s.id, newTokenHash: s.token_hash });
      if (current && safeEqualHex(tokenHash("learner", current), s.token_hash)) {
        return {
          sessionId: s.id,
          subjectId: s.user_id,
          deviceId: s.device_id,
          authAt: s.auth_at,
          reissue: { token: current, csrf: csrfFor("learner", s.id) },
        };
      }
    }
    await revokeSession(tx, "learner", s.id);
    return null;
  });
}

/** Xoay token học viên khi đã ≥ 7 ngày; hai lời gọi đồng thời chỉ một lần xoay (khóa dòng). */
export async function rotateIfDue(sessionId: string): Promise<{ token: string; csrf: string } | null> {
  return withTx(async (tx) => {
    const [s] = await tx.$queryRaw<{ token_hash: string }[]>`
      SELECT token_hash FROM learner_sessions
      WHERE id = ${sessionId}::uuid AND revoked_at IS NULL AND token_issued_at <= now() - interval '7 days'
      FOR UPDATE`;
    if (!s) return null;
    const token = randomToken();
    const newHash = tokenHash("learner", token);
    const envelope = sealNextToken({ realm: "learner", sessionId, newTokenHash: newHash, token });
    await tx.$executeRaw`
      INSERT INTO session_token_history (session_id, token_hash, detect_until)
      VALUES (${sessionId}::uuid, ${s.token_hash}, now() + interval '37 days')`;
    await tx.$executeRaw`
      UPDATE learner_sessions
      SET token_hash = ${newHash}, token_issued_at = now(),
          prev_valid_until = now() + interval '2 minutes', next_token_enc = ${envelope}
      WHERE id = ${sessionId}::uuid`;
    return { token, csrf: csrfFor("learner", sessionId) };
  });
}

export async function revokeSession(tx: Tx, realm: Realm, sessionId: string): Promise<void> {
  if (realm === "admin") {
    await tx.$executeRaw`UPDATE admin_sessions SET revoked_at = now() WHERE id = ${sessionId}::uuid AND revoked_at IS NULL`;
  } else {
    await tx.$executeRaw`
      UPDATE learner_sessions SET revoked_at = now(), prev_valid_until = NULL, next_token_enc = NULL
      WHERE id = ${sessionId}::uuid AND revoked_at IS NULL`;
  }
}

export async function revokeAllForSubject(tx: Tx, realm: Realm, subjectId: string): Promise<void> {
  if (realm === "admin") {
    await tx.$executeRaw`
      UPDATE admin_sessions SET revoked_at = now() WHERE admin_user_id = ${subjectId}::uuid AND revoked_at IS NULL`;
  } else {
    await tx.$executeRaw`
      UPDATE learner_sessions SET revoked_at = now(), prev_valid_until = NULL, next_token_enc = NULL
      WHERE user_id = ${subjectId}::uuid AND revoked_at IS NULL`;
  }
}

export async function revokeSessionsForDevice(tx: Tx, deviceId: string): Promise<void> {
  await tx.$executeRaw`
    UPDATE learner_sessions SET revoked_at = now(), prev_valid_until = NULL, next_token_enc = NULL
    WHERE device_id = ${deviceId}::uuid AND revoked_at IS NULL`;
}

/** Dọn phong bì hết cửa sổ, lịch sử token quá hạn phát hiện, vé và state hết hạn (job P4 gọi). */
export async function cleanupSessionArtifacts(at?: Date): Promise<void> {
  const ref = at ?? null;
  await withTx(async (tx) => {
    await tx.$executeRaw`
      UPDATE learner_sessions SET prev_valid_until = NULL, next_token_enc = NULL
      WHERE prev_valid_until <= coalesce(${ref}::timestamptz, now())`;
    await tx.$executeRaw`DELETE FROM session_token_history WHERE detect_until <= coalesce(${ref}::timestamptz, now())`;
    await tx.$executeRaw`DELETE FROM login_tickets WHERE expires_at <= coalesce(${ref}::timestamptz, now())`;
    await tx.$executeRaw`DELETE FROM oidc_states WHERE expires_at <= coalesce(${ref}::timestamptz, now())`;
  });
}

export function isRecentAuth(authAt: Date): boolean {
  return now().getTime() - authAt.getTime() < RECENT_AUTH_MS;
}
