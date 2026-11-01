import { prisma } from "@/lib/db";
import { authorize, permissionsFor } from "@/modules/auth-admin/authorize";
import { listQueue } from "@/modules/ledger/queue";
import type { AdminCtx } from "@/modules/sessions/guards";

const DAY_MS = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;

/** Khoảng báo cáo: gồm đầu `from`, không gồm đầu `to`. */
export type Range = { from: Date; to: Date };

/** `days` ngày gần nhất tính theo ngày Việt Nam, tới bây giờ. */
export function rangeOfLastDays(days: number, now = new Date()): Range {
  const startVn = Math.floor((now.getTime() + VN_OFFSET_MS) / DAY_MS) * DAY_MS;
  return { from: new Date(startVn - VN_OFFSET_MS - (days - 1) * DAY_MS), to: now };
}

/** Từ ngày tới ngày (YYYY-MM-DD, ngày Việt Nam, gồm cả hai đầu), tối đa 366 ngày; sai thì null. */
export function rangeOfDates(fromDay: string, toDay: string): Range | null {
  const start = (day: string) => {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00+07:00`) : NaN;
    return Number.isNaN(t) || new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10) !== day ? null : t;
  };
  const from = start(fromDay);
  const to = start(toDay);
  if (from === null || to === null || to < from || to - from >= 366 * DAY_MS) return null;
  return { from: new Date(from), to: new Date(to + DAY_MS) };
}

/**
 * Số liệu trang tổng quan. Tiền nhận và tiền hoàn trả riêng: định nghĩa “doanh thu” chưa được chủ dự án chốt nên không tính số ròng.
 */
export async function overview(ctx: AdminCtx, { from, to: now }: Range) {
  await authorize(ctx, "orders.view", { action: "overview_view" });
  const [row] = await prisma().$queryRaw<{ received: bigint; refunded: bigint; auto: number; manual: number; learners: number; refunds_open: number }[]>`
    SELECT
      (SELECT coalesce(sum(amount_due_vnd), 0)::bigint FROM orders WHERE paid_at >= ${from} AND paid_at < ${now}) AS received,
      (SELECT coalesce(sum(amount_vnd), 0)::bigint FROM refunds WHERE status = 'confirmed' AND confirmed_at >= ${from} AND confirmed_at < ${now}) AS refunded,
      (SELECT count(DISTINCT o.id)::int FROM orders o WHERE o.paid_at >= ${from} AND o.paid_at < ${now}
         AND EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id AND a.kind = 'auto')) AS auto,
      (SELECT count(DISTINCT o.id)::int FROM orders o WHERE o.paid_at >= ${from} AND o.paid_at < ${now}
         AND EXISTS (SELECT 1 FROM payment_allocations a WHERE a.order_id = o.id AND a.kind = 'manual')) AS manual,
      (SELECT count(*)::int FROM users WHERE created_at >= ${from} AND created_at < ${now}) AS learners,
      (SELECT count(*)::int FROM refunds WHERE status IN ('requested', 'approved', 'sent')) AS refunds_open`;
  // Theo id khóa (tên có thể trùng), tiền theo giá từng dòng hàng (đơn nhiều khóa không bị cộng trùng). Hoàn theo khóa: chỉ hoàn
  // toàn phần đã xác nhận trong khoảng (hoàn phần thừa không thuộc khóa nào).
  const byCourse = await prisma().$queryRaw<{ id: string; course: string; paid: number; received: bigint; refunded_orders: number; refunded: bigint }[]>`
    WITH paid AS (
      SELECT i.course_id, count(DISTINCT o.id) AS paid, sum(i.final_price_vnd) AS received
      FROM orders o JOIN order_items i ON i.order_id = o.id
      WHERE o.paid_at >= ${from} AND o.paid_at < ${now} GROUP BY i.course_id
    ), refunded AS (
      SELECT i.course_id, count(DISTINCT r.order_id) AS orders, sum(i.final_price_vnd) AS amount
      FROM refunds r JOIN order_items i ON i.order_id = r.order_id
      WHERE r.kind = 'full' AND r.status = 'confirmed' AND r.confirmed_at >= ${from} AND r.confirmed_at < ${now} GROUP BY i.course_id
    )
    SELECT c.id, c.title_vi AS course, coalesce(p.paid, 0)::int AS paid, coalesce(p.received, 0)::bigint AS received,
           coalesce(f.orders, 0)::int AS refunded_orders, coalesce(f.amount, 0)::bigint AS refunded
    FROM paid p FULL JOIN refunded f ON f.course_id = p.course_id JOIN courses c ON c.id = coalesce(p.course_id, f.course_id)
    ORDER BY received DESC, c.title_vi`;
  const queue = await listQueue({ raw: false });
  const canSeeJobErrors = permissionsFor(ctx).includes("jobs.run");
  const recentOrders = await prisma().$queryRaw<{ code: string; status: string; amount_due_vnd: number; created_at: Date; title_vi: string; display_name: string }[]>`
    SELECT o.code, o.status, o.amount_due_vnd, o.created_at, c.title_vi, u.display_name
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id JOIN users u ON u.id = o.user_id
    ORDER BY o.created_at DESC, o.id DESC LIMIT 10`;
  const jobs = await prisma().$queryRaw<{ job_name: string; status: string; started_at: Date; error: string | null }[]>`
    SELECT DISTINCT ON (job_name) job_name, status, started_at, error FROM job_runs
    WHERE started_at > now() - interval '3 days' ORDER BY job_name, started_at DESC`;
  return {
    // Tổng có thể vượt int4 (khoảng 2,1 tỷ): tính bigint, đổi sang number (VND luôn nhỏ hơn giới hạn an toàn).
    receivedVnd: Number(row!.received),
    refundedVnd: Number(row!.refunded),
    paidOrders: { auto: row!.auto, manual: row!.manual },
    newLearners: row!.learners,
    byCourse: byCourse.map((c) => ({
      courseId: c.id, course: c.course, paidOrders: c.paid, receivedVnd: Number(c.received), refundedOrders: c.refunded_orders, refundedVnd: Number(c.refunded),
    })),
    refundsOpen: row!.refunds_open,
    queueOpen: queue.length,
    oldestQueue: [...queue].sort((a, b) => Number(a.bankTime) - Number(b.bankTime)).slice(0, 5),
    recentOrders: recentOrders.map((o) => ({
      code: o.code, status: o.status, amountVnd: o.amount_due_vnd, createdAt: o.created_at, course: o.title_vi, learner: o.display_name,
    })),
    // Nội dung lỗi có thể chứa chi tiết nhà cung cấp: chỉ người có quyền quản lý job xem.
    jobs: jobs.map((j) => ({ name: j.job_name, status: j.status, startedAt: j.started_at, error: canSeeJobErrors ? j.error : null })),
  };
}
