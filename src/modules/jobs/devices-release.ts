import { prisma } from "@/lib/db";
import { revokeDevice } from "@/modules/auth-learner/devices";
import { WAIT_FOR_SYNC_LOCKS } from "@/modules/learn/sync";
import { withFence, type Lease } from "./lease";

// Giấy phép học offline 30 ngày + ân hạn 7 ngày (đề xuất G9/G10): máy còn trong hạn này có thể đang học trên tàu, không được thu hồi.
const OFFLINE_WINDOW_DAYS = 37;

/** Thu hồi từng máy quá hạn trong một transaction riêng; kiểm lại dưới khóa vì máy có thể vừa đồng bộ. */
export async function releaseStaleDevices(lease: Lease, signal: AbortSignal): Promise<{ released: number }> {
  const candidates = await prisma().$queryRaw<{ id: string; user_id: string }[]>`
    SELECT id::text AS id, user_id::text AS user_id FROM devices
    WHERE revoked_at IS NULL
      AND coalesce(last_seen_at, registered_at) < now() - make_interval(days => ${OFFLINE_WINDOW_DAYS})`;
  let released = 0;
  for (const candidate of candidates) {
    if (signal.aborted) break;
    const revoked = await withFence(lease, async (tx) => {
      // Cùng thứ tự khóa với đồng bộ: học viên → thiết bị.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.user_id}::uuid FOR UPDATE`;
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM devices
        WHERE id = ${candidate.id}::uuid AND revoked_at IS NULL
          AND coalesce(last_seen_at, registered_at) < now() - make_interval(days => ${OFFLINE_WINDOW_DAYS})
        FOR UPDATE`;
      if (!row) return false;
      await revokeDevice(tx, candidate.id);
      return true;
    }, WAIT_FOR_SYNC_LOCKS);
    if (revoked) released++;
  }
  return { released };
}
