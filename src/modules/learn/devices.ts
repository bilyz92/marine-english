import { prisma, withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { lockActiveUser, revokeDevice } from "@/modules/auth-learner/devices";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx, LearnerCtx } from "@/modules/sessions/guards";
import { isRecentAuth } from "@/modules/sessions/sessions";

// Thiết bị: học viên tự xem và gỡ (cần xác thực gần đây); hỗ trợ gỡ hộ có nhật ký — DG §6.

export type MyDevice = { id: string; label: string; registeredAt: Date; lastSeenAt: Date | null; current: boolean };

export async function listMyDevices(ctx: LearnerCtx): Promise<MyDevice[]> {
  const rows = await prisma().device.findMany({
    where: { userId: ctx.userId, revokedAt: null },
    orderBy: { registeredAt: "asc" },
    select: { id: true, label: true, registeredAt: true, lastSeenAt: true },
  });
  return rows.map((d) => ({ ...d, current: d.id === ctx.deviceId }));
}

export async function removeMyDevice(ctx: LearnerCtx, deviceId: string): Promise<"removed" | "reauth_required" | "not_found"> {
  if (!isRecentAuth(ctx.authAt)) return "reauth_required";
  return withTx(async (tx) => {
    await lockActiveUser(tx, ctx.userId);
    const [device] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM devices WHERE id = ${deviceId}::uuid AND user_id = ${ctx.userId}::uuid AND revoked_at IS NULL`;
    if (!device) return "not_found";
    await revokeDevice(tx, deviceId);
    return "removed";
  });
}

export async function listUserDevices(ctx: AdminCtx, userId: string) {
  await authorize(ctx, "devices.remove", { action: "devices_view", resource: { type: "user", id: userId } });
  return prisma().device.findMany({
    where: { userId, revokedAt: null },
    orderBy: { registeredAt: "asc" },
    select: { id: true, label: true, registeredAt: true, lastSeenAt: true },
  });
}

export async function adminRemoveDevice(ctx: AdminCtx, deviceId: string, reason: string): Promise<"removed" | "not_found"> {
  await authorize(ctx, "devices.remove", { action: "device_remove", resource: { type: "device", id: deviceId } });
  const why = reason.trim();
  if (!why) throw new HttpError(400, "Cần lý do gỡ thiết bị");
  const result = await withTx(async (tx) => {
    const [owner] = await tx.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM devices WHERE id = ${deviceId}::uuid`;
    if (!owner) return "not_found" as const;
    // Cùng thứ tự khóa với đồng bộ: học viên → thiết bị. Thu hồi có điều kiện: hai người gỡ cùng lúc chỉ một người thắng.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${owner.user_id}::uuid FOR UPDATE`;
    const [device] = await tx.$queryRaw<{ user_id: string }[]>`
      UPDATE devices SET revoked_at = now() WHERE id = ${deviceId}::uuid AND revoked_at IS NULL RETURNING user_id`;
    if (!device) return "not_found" as const;
    await revokeDevice(tx, deviceId);
    await audit(tx, {
      adminId: ctx.adminId, action: "device_remove", targetType: "device", targetId: deviceId,
      after: { userId: device.user_id }, result: "ok", reason: why, ip: ctx.ip,
    });
    return "removed" as const;
  });
  if (result === "not_found") {
    await auditDenied({ adminId: ctx.adminId, action: "device_remove", targetType: "device", targetId: deviceId, reason: "not_found", ip: ctx.ip });
  }
  return result;
}
