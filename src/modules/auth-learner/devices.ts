import { randomToken } from "@/lib/crypto";
import { withTx, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { createSession, InactiveUserError, revokeSessionsForDevice, tokenHash } from "@/modules/sessions/sessions";

// Khóa thiết bị: 32 byte sinh trên máy, base64url 43 ký tự. Máy chủ chỉ lưu HMAC.
const DEVICE_KEY = /^[A-Za-z0-9_-]{43}$/;

export type DeviceSummary = { id: string; label: string; lastSeenAt: Date | null };

export type AuthOutcome =
  | { kind: "session"; token: string; csrf: string }
  | { kind: "choose_device"; ticket: string; devices: DeviceSummary[] };

export function hashDeviceKey(deviceKey: string): string {
  if (!DEVICE_KEY.test(deviceKey)) throw new HttpError(400, "Khóa thiết bị không hợp lệ");
  return tokenHash("learner", deviceKey);
}

/** Kiểm khóa thiết bị trong body thô trước mọi bước khác của route (sai hoặc thiếu → 400). */
export function deviceKeyHashFrom(body: unknown): string {
  const key = (body as { deviceKey?: unknown } | null | undefined)?.deviceKey;
  return hashDeviceKey(typeof key === "string" ? key : "");
}

/** Khóa dòng học viên; tài khoản không còn active thì ném InactiveUserError. */
async function lockActiveUser(tx: Tx, userId: string): Promise<void> {
  const [user] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  if (user?.status !== "active") throw new InactiveUserError();
}

async function activeDevices(tx: Tx, userId: string): Promise<DeviceSummary[]> {
  const rows = await tx.$queryRaw<{ id: string; label: string; last_seen_at: Date | null }[]>`
    SELECT id, label, last_seen_at FROM devices WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    ORDER BY last_seen_at DESC NULLS LAST, registered_at DESC`;
  return rows.map((r) => ({ id: r.id, label: r.label, lastSeenAt: r.last_seen_at }));
}

/** Kích hoạt lại dòng thiết bị đã bị thu hồi của bản cài này, hoặc chèn mới. Không bao giờ chèn trùng (user, khóa). */
async function activateDevice(tx: Tx, userId: string, deviceKeyHash: string, label: string, existingId?: string): Promise<string> {
  if (existingId) {
    await tx.$executeRaw`
      UPDATE devices SET revoked_at = NULL, last_seen_at = now(), label = ${label} WHERE id = ${existingId}::uuid`;
    return existingId;
  }
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO devices (user_id, device_key_hash, label, last_seen_at)
    VALUES (${userId}::uuid, ${deviceKeyHash}, ${label}, now()) RETURNING id`;
  return row!.id;
}

/**
 * Bước cuối sau khi xác minh danh tính: dùng lại thiết bị của bản cài này, hoặc thêm thiết bị khi còn chỗ,
 * hoặc khi đã đủ MAX_DEVICES thì phát vé thay máy (chưa tạo phiên).
 */
export async function completeLearnerAuth(
  tx: Tx,
  input: { userId: string; deviceKeyHash: string; deviceLabel: string; authAt: Date },
): Promise<AuthOutcome> {
  const { userId, deviceKeyHash, deviceLabel, authAt } = input;
  await lockActiveUser(tx, userId);
  const [own] = await tx.$queryRaw<{ id: string; revoked: boolean }[]>`
    SELECT id, revoked_at IS NOT NULL AS revoked FROM devices
    WHERE user_id = ${userId}::uuid AND device_key_hash = ${deviceKeyHash}`;

  let deviceId: string;
  if (own && !own.revoked) {
    await tx.$executeRaw`UPDATE devices SET last_seen_at = now() WHERE id = ${own.id}::uuid`;
    deviceId = own.id;
  } else {
    const devices = await activeDevices(tx, userId);
    if (devices.length >= env().MAX_DEVICES) {
      const ticket = randomToken();
      await tx.$executeRaw`
        INSERT INTO login_tickets (token_hash, user_id, device_key_hash, device_label, expires_at)
        VALUES (${tokenHash("learner", ticket)}, ${userId}::uuid, ${deviceKeyHash}, ${deviceLabel}, now() + interval '10 minutes')`;
      return { kind: "choose_device", ticket, devices };
    }
    deviceId = await activateDevice(tx, userId, deviceKeyHash, deviceLabel, own?.id);
  }
  const s = await createSession(tx, { realm: "learner", userId, deviceId, authAt });
  return { kind: "session", token: s.token, csrf: s.csrf };
}

/** Dùng vé (một lần) để thay một máy đang hoạt động bằng bản cài hiện tại. Mọi sai lệch → null. */
export async function consumeTicketAndReplace(input: {
  ticket: string;
  deviceKey: string;
  replaceDeviceId: string;
}): Promise<{ token: string; csrf: string } | null> {
  const deviceKeyHash = hashDeviceKey(input.deviceKey);
  return withTx(async (tx) => {
    const [t] = await tx.$queryRaw<{ user_id: string; device_key_hash: string; device_label: string; created_at: Date }[]>`
      UPDATE login_tickets SET used_at = now()
      WHERE token_hash = ${tokenHash("learner", input.ticket)} AND used_at IS NULL AND expires_at > now()
        AND realm = 'learner' AND purpose = 'replace_device'
      RETURNING user_id, device_key_hash, device_label, created_at`;
    if (!t || t.device_key_hash !== deviceKeyHash) return null;
    try {
      await lockActiveUser(tx, t.user_id);
    } catch (error) {
      if (error instanceof InactiveUserError) return null;
      throw error;
    }
    const devices = await activeDevices(tx, t.user_id);
    // Thay một máy đang hoạt động thì số máy không tăng; vẫn chặn nếu dữ liệu đã vượt giới hạn.
    if (!devices.some((d) => d.id === input.replaceDeviceId) || devices.length > env().MAX_DEVICES) return null;
    await revokeDevice(tx, input.replaceDeviceId);

    const [own] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM devices WHERE user_id = ${t.user_id}::uuid AND device_key_hash = ${deviceKeyHash}`;
    const deviceId = await activateDevice(tx, t.user_id, deviceKeyHash, t.device_label, own?.id);
    const s = await createSession(tx, { realm: "learner", userId: t.user_id, deviceId, authAt: t.created_at });
    return { token: s.token, csrf: s.csrf };
  });
}

/** Thu hồi một thiết bị và mọi phiên của nó. */
export async function revokeDevice(tx: Tx, deviceId: string): Promise<void> {
  await tx.$executeRaw`UPDATE devices SET revoked_at = now() WHERE id = ${deviceId}::uuid AND revoked_at IS NULL`;
  await revokeSessionsForDevice(tx, deviceId);
}
