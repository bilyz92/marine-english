import { prisma } from "@/lib/db";
import { listQueue } from "@/modules/ledger/queue";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import { withFence, type Lease } from "./lease";

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

export type DailySummary = { day: string; paidOrders: number; revenueVnd: number; refunds: number; queueOpen: number; outboxDead: number };

/** Số liệu trong ngày chứa `now` theo giờ Việt Nam (00:00–24:00); hàng chờ và thông báo hỏng là số hiện tại. */
export async function dailySummary(now: Date): Promise<DailySummary> {
  const startVn = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS;
  const from = new Date(startVn - VN_OFFSET_MS);
  const to = new Date(from.getTime() + DAY_MS);
  const [row] = await prisma().$queryRaw<{ paid: number; revenue: number; refunds: number; dead: number }[]>`
    SELECT
      (SELECT count(*)::int FROM orders WHERE paid_at >= ${from} AND paid_at < ${to}) AS paid,
      (SELECT coalesce(sum(amount_due_vnd), 0)::int FROM orders WHERE paid_at >= ${from} AND paid_at < ${to}) AS revenue,
      (SELECT count(*)::int FROM refunds WHERE status = 'confirmed' AND confirmed_at >= ${from} AND confirmed_at < ${to}) AS refunds,
      (SELECT count(*)::int FROM outbox_events WHERE status = 'dead') AS dead`;
  return {
    day: new Date(startVn).toISOString().slice(0, 10),
    paidOrders: row!.paid,
    revenueVnd: row!.revenue,
    refunds: row!.refunds,
    queueOpen: (await listQueue({ raw: false })).length,
    outboxDead: row!.dead,
  };
}

/** Xếp tin tổng kết vào outbox dưới fencing; khóa theo ngày nên chạy lại trong ngày không gửi thêm. */
export async function enqueueDailySummary(lease: Lease, now: Date): Promise<DailySummary> {
  const summary = await dailySummary(now);
  await withFence(lease, (tx) =>
    enqueueOutbox(tx, { dedupKey: `daily_summary:${summary.day}`, kind: "daily_summary", channel: "telegram", payload: summary }),
  );
  return summary;
}
