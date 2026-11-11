import { prisma, withTx, type Tx } from "@/lib/db";
import { lockActiveUser } from "@/modules/auth-learner/devices";
import { hasActiveEnrollment, mergeGroupIds } from "@/modules/enrollments/access";
import { listQueue, orderManualState, type ManualTransfer } from "@/modules/ledger/queue";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { newOrderCode } from "./codes";
import { env } from "@/lib/env";
import { paymentInfo, sepayEnabled } from "./payment-info";
import { vietQrPayload } from "./vietqr";
import { CLAIM_WINDOW, claimable, claimView, type ClaimView } from "./claims";

// Đơn: giá luôn lấy từ courses trên máy chủ, ghi ảnh chụp bất biến; mã đơn ngẫu nhiên, duy nhất nhờ ràng buộc DB.

export const REFUND_POLICY_VERSION = "de-xuat-2026-10"; // [G13]
const MAX_CODE_ATTEMPTS = 5;

export class OrderCodeExhaustedError extends Error {
  constructor() {
    super("Không sinh được mã đơn chưa dùng");
  }
}

export type OrderStatus = "pending" | "paid" | "expired" | "refunded";
export type OrderView = { code: string; status: OrderStatus; amountDueVnd: number; expiresAt: Date; courseSlug: string; courseTitleVi: string };
export type CreateOrderResult =
  | { kind: "created" | "existing"; order: OrderView }
  | { kind: "not_for_sale" | "already_enrolled" };

type ViewRow = { id: string; course_id: string; code: string; status: OrderStatus; amount_due_vnd: number; expires_at: Date; slug: string; title_vi: string };

const toView = (r: ViewRow): OrderView => ({
  code: r.code, status: r.status, amountDueVnd: r.amount_due_vnd, expiresAt: r.expires_at, courseSlug: r.slug, courseTitleVi: r.title_vi,
});

async function orderViews(db: Tx | ReturnType<typeof prisma>, where: { code?: string; userIds: string[]; courseId?: string; pendingOnly?: boolean }) {
  return db.$queryRaw<ViewRow[]>`
    SELECT o.id, c.id AS course_id, o.code, o.status, o.amount_due_vnd, o.expires_at, c.slug, c.title_vi
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id
    WHERE o.user_id = ANY(${where.userIds}::uuid[])
      AND (${where.code ?? null}::text IS NULL OR o.code = ${where.code ?? null})
      AND (${where.courseId ?? null}::uuid IS NULL OR i.course_id = ${where.courseId ?? null}::uuid)
      AND (NOT ${where.pendingOnly ?? false} OR (o.status = 'pending' AND o.expires_at > now()))
    ORDER BY o.created_at DESC`;
}

export async function createOrder(
  ctx: LearnerCtx,
  courseSlug: string,
  opts: { codeSource?: () => string; termsVersion?: string } = {},
): Promise<CreateOrderResult> {
  const codeSource = opts.codeSource ?? newOrderCode;
  const recordTerms = async (tx: Tx, orderId: string) => {
    if (!opts.termsVersion) return;
    await tx.$executeRaw`
      INSERT INTO order_terms_acceptances (order_id, user_id, terms_version)
      VALUES (${orderId}::uuid, ${ctx.userId}::uuid, ${opts.termsVersion})
      ON CONFLICT (order_id) DO NOTHING`;
  };
  return withTx(async (tx) => {
    // Khóa học viên để hai lần bấm “mua” cùng lúc chỉ tạo một đơn.
    await lockActiveUser(tx, ctx.userId);
    const [course] = await tx.$queryRaw<{ id: string; price_vnd: number; current_version_id: string }[]>`
      SELECT id, price_vnd, current_version_id FROM courses WHERE slug = ${courseSlug} AND status = 'published'`;
    if (!course) return { kind: "not_for_sale" };
    const group = await mergeGroupIds(tx, ctx.userId);
    if (await hasActiveEnrollment(tx, group, course.id)) return { kind: "already_enrolled" };
    const [pending] = await orderViews(tx, { userIds: group, courseId: course.id, pendingOnly: true });
    if (pending) {
      await recordTerms(tx, pending.id);
      return { kind: "existing", order: toView(pending) };
    }

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const [order] = await tx.$queryRaw<{ id: string; code: string }[]>`
        INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at)
        VALUES (${codeSource()}, ${ctx.userId}::uuid, ${course.price_vnd}, ${REFUND_POLICY_VERSION}, now() + interval '15 minutes')
        ON CONFLICT (code) DO NOTHING
        RETURNING id, code`;
      if (!order) continue;
      await tx.$executeRaw`
        INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
        VALUES (${order.id}::uuid, ${course.id}::uuid, ${course.current_version_id}::uuid, ${course.price_vnd}, ${course.price_vnd})`;
      await recordTerms(tx, order.id);
      const [view] = await orderViews(tx, { userIds: [ctx.userId], code: order.code });
      return { kind: "created", order: toView(view!) };
    }
    throw new OrderCodeExhaustedError();
  });
}

/** Đơn của học viên (theo nhóm gộp). */
export async function getOrderForLearner(ctx: LearnerCtx, code: string): Promise<OrderView | null> {
  const [row] = await orderViews(prisma(), { userIds: await mergeGroupIds(null, ctx.userId), code });
  return row ? toView(row) : null;
}

export type CheckoutView = OrderView & {
  /** Thông tin chuyển khoản: chỉ có khi đơn còn trong hạn và đã đủ cấu hình. */
  payment: { bankName: string; accountNo: string; accountName: string; qrImageUrl: string | null; qrPayload: string | null; autoConfirm: boolean } | null;
  /** Đơn còn hạn nhưng cấu hình nhận tiền vừa bị gỡ: không phải hết hạn, chỉ là tạm ngừng nhận tiền. */
  paymentUnavailable: boolean;
  enrolled: boolean;
  needsManual: boolean;
  /** Khoản chuyển của đơn đang chờ đối chiếu tay (số tiền, lý do), để báo chuyển thiếu/thừa/muộn. */
  manualTransfers: ManualTransfer[];
  /** Khách đã bấm "Tôi đã chuyển khoản" chưa và chủ đã duyệt/khóa lại chưa. */
  claim: ClaimView;
  /** Còn bấm "Tôi đã chuyển khoản" được (chưa có SePay, đơn chưa quá 24 giờ). */
  claimable: boolean;
  /** Giờ máy chủ: máy trên tàu có thể lệch giờ, đếm ngược không dựa vào đồng hồ máy. */
  serverNow: Date;
};

/** Chuỗi VietQR của đơn; dữ liệu không dựng được QR thì trả null (trang dùng ảnh QR tĩnh), không làm hỏng trang. */
function orderQr(bin: string, accountNo: string, amountVnd: number, code: string): string | null {
  try {
    return vietQrPayload({ bin, accountNo, amountVnd, content: code });
  } catch {
    return null;
  }
}

/** Trạng thái đơn cho trang thanh toán; chỉ đọc, không mở khóa gì. */
export async function getCheckoutForLearner(ctx: LearnerCtx, code: string): Promise<CheckoutView | null> {
  const group = await mergeGroupIds(null, ctx.userId);
  const [row] = await orderViews(prisma(), { userIds: group, code });
  if (!row) return null;
  const serverNow = new Date();
  const open = row.status === "pending" && row.expires_at > serverNow;
  const claim = await claimView(prisma(), row.id);
  const info = open ? paymentInfo() : null;
  const manual = await orderManualState(row.id, row.code);
  return {
    ...toView(row),
    // Có mã BIN: QR dựng cho đúng đơn này (số tiền và mã đơn đã điền sẵn); không thì ảnh QR tĩnh.
    payment: info && {
      bankName: info.bankName, accountNo: info.accountNo, accountName: info.accountName, qrImageUrl: info.qrImageUrl,
      qrPayload: info.bankBin ? orderQr(info.bankBin, info.accountNo, row.amount_due_vnd, row.code) : null,
      // Webhook SePay xử lý được thì tiền về là tự mở khóa; chưa thì quản trị xác nhận tay (trang báo đúng như vậy).
      autoConfirm: sepayEnabled(env()),
    },
    paymentUnavailable: open && !info,
    enrolled: await hasActiveEnrollment(prisma(), group, row.course_id),
    needsManual: manual.needsManual,
    manualTransfers: manual.transfers,
    claim,
    claimable: await claimable(prisma(), row.id, claim),
    serverNow,
  };
}

/**
 * Trước khi mua: đã có khóa chưa, và đơn gần đây chưa xong (hết hạn trong 48 giờ hoặc đang chờ đối chiếu tay) của khóa này,
 * để người đã chuyển tiền không bị dẫn tới chuyển lần nữa.
 */
export async function recentOrdersForCourse(ctx: LearnerCtx, courseSlug: string) {
  const group = await mergeGroupIds(null, ctx.userId);
  const [course] = await prisma().$queryRaw<{ id: string }[]>`SELECT id FROM courses WHERE slug = ${courseSlug}`;
  if (!course) return { enrolled: false, unresolved: [] };
  const rows = await prisma().$queryRaw<(ViewRow & { recent: boolean })[]>`
    SELECT o.id, c.id AS course_id, o.code, o.status, o.amount_due_vnd, o.expires_at, c.slug, c.title_vi,
           o.expires_at > now() - interval '48 hours' AS recent
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id
    WHERE o.user_id = ANY(${group}::uuid[]) AND i.course_id = ${course.id}::uuid
      AND o.status IN ('pending', 'expired') AND o.expires_at <= now()
    ORDER BY o.created_at DESC`;
  // Đơn có khoản chuyển đang chờ đối chiếu tay hiện mãi tới khi xử lý xong, không chỉ trong 48 giờ.
  // Kể cả khoản ghi nhiều mã đơn (chưa chọn được đơn ứng viên chính).
  const manual = new Set((await listQueue({ raw: false })).flatMap((q) => [q.candidateOrderCode, ...q.candidateCodes]).filter(Boolean));
  return {
    enrolled: await hasActiveEnrollment(prisma(), group, course.id),
    unresolved: rows.filter((r) => r.recent || manual.has(r.code)).map((r) => ({ code: r.code, status: r.status, expiresAt: r.expires_at })),
  };
}

/** Lịch sử thanh toán (menu điện thoại): mọi đơn của học viên (cả nhóm tài khoản đã gộp), mới nhất trước. */
export async function paymentHistory(ctx: LearnerCtx) {
  const group = await mergeGroupIds(null, ctx.userId);
  // Số giây còn được chuyển khoản tính bằng giờ máy chủ (giờ điện thoại trên tàu có thể sai).
  const rows = await prisma().$queryRaw<{ code: string; status: string; amount_due_vnd: number; created_at: Date; paid_at: Date | null; expires_at: Date; slug: string; title_vi: string; payable_s: number; in_claim_window: boolean; claim: "open" | "rejected" | null; reason: string | null }[]>`
    SELECT o.code, o.status, o.amount_due_vnd, o.created_at, o.paid_at, o.expires_at, c.slug, c.title_vi,
           CASE WHEN EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id AND e.revoked_at IS NULL) THEN 'open'
                WHEN o.status IN ('pending', 'expired') AND EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id) THEN 'rejected'
           END AS claim,
           (SELECT r.reason FROM transfer_claim_rejections r WHERE r.order_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS reason,
           CASE WHEN o.status = 'pending' THEN greatest(0, floor(extract(epoch FROM o.expires_at - now())))::int ELSE 0 END AS payable_s,
           o.status IN ('pending', 'expired') AND o.created_at >= now() - ${CLAIM_WINDOW}::interval AS in_claim_window
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id
    WHERE o.user_id = ANY(${group}::uuid[])
    ORDER BY o.created_at DESC
    LIMIT 100`;
  return rows.map((r) => ({
    code: r.code, status: r.status, amountVnd: r.amount_due_vnd, createdAt: r.created_at, paidAt: r.paid_at, slug: r.slug, course: r.title_vi,
    payableForSeconds: r.payable_s,
    // Đơn hết 15 phút vẫn báo đã chuyển được trong 24 giờ: Lịch sử phải đưa được khách tới trang đó.
    claimable: r.in_claim_window && !r.claim && !sepayEnabled(env()),
    // Khách đã báo chuyển khoản: "open" đang học tạm chờ chủ xác nhận; "rejected" bị khóa lại, kèm lý do của chủ.
    claim: r.claim, rejectionReason: r.claim === "rejected" ? r.reason : null,
  }));
}

/** pending → expired khi đã quá hạn. P4 gọi mỗi phút. */
export async function expireOrders(): Promise<number> {
  return prisma().$executeRaw`
    UPDATE orders SET status = 'expired', expired_at = now() WHERE status = 'pending' AND expires_at <= now()`;
}
