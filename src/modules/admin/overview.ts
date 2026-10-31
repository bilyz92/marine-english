import { prisma } from "@/lib/db";
import { authorize } from "@/modules/auth-admin/authorize";
import { listQueue } from "@/modules/ledger/queue";
import type { AdminCtx } from "@/modules/sessions/guards";

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/** Đầu ngày giờ Việt Nam của `days - 1` ngày trước; khoảng tính gồm đầu trái, không gồm đầu phải. */
function vnRangeStart(days: number, now: Date): Date {
  const startVn = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS;
  return new Date(startVn - VN_OFFSET_MS - (days - 1) * DAY_MS);
}

/**
 * Số liệu trang tổng quan. Tiền nhận và tiền hoàn trả riêng: định nghĩa “doanh thu” chưa được chủ dự án chốt nên không tính số ròng.
 */
export async function overview(ctx: AdminCtx, days: number) {
  await authorize(ctx, "orders.view", { action: "overview_view" });
  const now = new Date();
  const from = vnRangeStart(days, now);
  const [row] = await prisma().$queryRaw<{ received: number; refunded: number; auto: number; manual: number; learners: number; refunds_open: number }[]>`
    SELECT
      (SELECT coalesce(sum(amount_due_vnd), 0)::int FROM orders WHERE paid_at >= ${from} AND paid_at < ${now}) AS received,
      (SELECT coalesce(sum(amount_vnd), 0)::int FROM refunds WHERE status = 'confirmed' AND confirmed_at >= ${from} AND confirmed_at < ${now}) AS refunded,
      (SELECT count(DISTINCT o.id)::int FROM orders o WHERE o.paid_at >= ${from} AND o.paid_at < ${now}
         AND EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id AND a.kind = 'auto')) AS auto,
      (SELECT count(DISTINCT o.id)::int FROM orders o WHERE o.paid_at >= ${from} AND o.paid_at < ${now}
         AND EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id AND a.kind = 'manual')) AS manual,
      (SELECT count(*)::int FROM users WHERE created_at >= ${from} AND created_at < ${now}) AS learners,
      (SELECT count(*)::int FROM refunds WHERE status IN ('requested', 'approved', 'sent')) AS refunds_open`;
  const queue = await listQueue({ raw: false });
  const recentOrders = await prisma().$queryRaw<{ code: string; status: string; amount_due_vnd: number; created_at: Date; title_vi: string; display_name: string }[]>`
    SELECT o.code, o.status, o.amount_due_vnd, o.created_at, c.title_vi, u.display_name
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC, o.id DESC LIMIT 10`;
  const jobs = await prisma().$queryRaw<{ job_name: string; status: string; started_at: Date; error: string | null }[]>`
    SELECT DISTINCT ON (job_name) job_name, status, started_at, error FROM job_runs
    WHERE started_at > now() - interval '3 days' ORDER BY job_name, started_at DESC`;
  return {
    receivedVnd: row!.received,
    refundedVnd: row!.refunded,
    paidOrders: { auto: row!.auto, manual: row!.manual },
    newLearners: row!.learners,
    refundsOpen: row!.refunds_open,
    queueOpen: queue.length,
    oldestQueue: [...queue].sort((a, b) => Number(a.bankTime) - Number(b.bankTime)).slice(0, 5),
    recentOrders: recentOrders.map((o) => ({
      code: o.code, status: o.status, amountVnd: o.amount_due_vnd, createdAt: o.created_at, course: o.title_vi, learner: o.display_name,
    })),
    jobs: jobs.map((j) => ({ name: j.job_name, status: j.status, startedAt: j.started_at, error: j.error })),
  };
}
