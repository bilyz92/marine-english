import { z } from "zod";
import { prisma, withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import { mergeGroupIds } from "@/modules/enrollments/access";
import type { AdminCtx, LearnerCtx } from "@/modules/sessions/guards";

// Hoàn tiền tay — DG §2.9, TD §4.6 (chưa có điều chỉnh sau xác nhận: G13).
// Thứ tự khóa: các dòng sổ nguồn (id tăng dần) → đơn → refund. Hoàn toàn phần được xác nhận thì thu hồi quyền học của đơn.

type Source = { id: string; amount_vnd: number; bank_time: Date; used: number };

/** Khóa các dòng sổ đã phân bổ cho đơn; kèm số tiền đã dùng cho refund còn hiệu lực. */
async function lockOrderSources(tx: Tx, orderId: string): Promise<Source[]> {
  return tx.$queryRaw<Source[]>`
    SELECT bt.id, bt.amount_vnd, bt.bank_time,
           coalesce((SELECT sum(rs.amount_vnd) FROM refund_sources rs JOIN refunds r ON r.id = rs.refund_id
                     WHERE rs.bank_transaction_id = bt.id AND r.status NOT IN ('failed', 'cancelled')), 0)::int AS used
    FROM bank_transactions bt JOIN payment_allocations pa ON pa.bank_transaction_id = bt.id
    WHERE pa.order_id = ${orderId}::uuid
    ORDER BY bt.id FOR UPDATE OF bt`;
}

/** Tài khoản nhận tiền hoàn do học viên khai (BR-18). */
export type Payout = { bankName: string; accountNo: string; accountName: string };
export const PayoutSchema = z.object({
  bankName: z.string().trim().min(2).max(100),
  accountNo: z.string().trim().regex(/^[0-9]{4,30}$/),
  accountName: z.string().trim().min(2).max(100),
});

type FullRefundRejection = "not_paid" | "active_full_refund";

/** Lõi tạo yêu cầu hoàn toàn phần cho một đơn đã thanh toán (người gọi đã kiểm quyền và đơn thuộc về ai). */
async function createFullRefund(
  tx: Tx,
  orderId: string,
  input: { reason: string; requestedBy?: string; requestedByUser?: string; payout?: Payout },
): Promise<{ refundId: string; amountVnd: number; orderCode: string } | { rejected: FullRefundRejection }> {
  const sources = await lockOrderSources(tx, orderId);
  const [order] = await tx.$queryRaw<{ status: string; amount_due_vnd: number; code: string }[]>`
    SELECT status, amount_due_vnd, code FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  if (order!.status !== "paid") return { rejected: "not_paid" };
  const [active] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM refunds WHERE order_id = ${orderId}::uuid AND kind = 'full' AND status NOT IN ('failed', 'cancelled')`;
  if (active) return { rejected: "active_full_refund" };

  const p = input.payout;
  const [refund] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO refunds (order_id, kind, amount_vnd, reason, requested_by, requested_by_user, payout_bank_name, payout_account_no, payout_account_name)
    VALUES (${orderId}::uuid, 'full', ${order!.amount_due_vnd}, ${input.reason}, ${input.requestedBy ?? null}::uuid, ${input.requestedByUser ?? null}::uuid,
            ${p?.bankName ?? null}, ${p?.accountNo ?? null}, ${p?.accountName ?? null}) RETURNING id`;
  // Nguồn: dòng sổ có bank_time muộn nhất trước, chỉ phần tiền chưa bị refund khác giữ.
  let remaining = order!.amount_due_vnd;
  for (const s of [...sources].sort((a, b) => b.bank_time.getTime() - a.bank_time.getTime() || b.id.localeCompare(a.id))) {
    const amount = Math.min(remaining, s.amount_vnd - s.used);
    if (amount <= 0) continue;
    await tx.$executeRaw`
      INSERT INTO refund_sources (refund_id, bank_transaction_id, amount_vnd) VALUES (${refund!.id}::uuid, ${s.id}::uuid, ${amount})`;
    remaining -= amount;
    if (remaining === 0) break;
  }
  return { refundId: refund!.id, amountVnd: order!.amount_due_vnd, orderCode: order!.code };
}

export async function requestFullRefund(
  ctx: AdminCtx,
  input: { orderCode: string; reason: string; payout?: Payout },
): Promise<{ refundId: string } | { rejected: FullRefundRejection }> {
  await authorize(ctx, "refunds.request", { action: "refund_request", resource: { type: "order", id: input.orderCode } });
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Cần lý do hoàn tiền");
  const result = await withTx(async (tx) => {
    const [found] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${input.orderCode}`;
    if (!found) return { rejected: "not_paid" as const };
    const created = await createFullRefund(tx, found.id, { reason, requestedBy: ctx.adminId, payout: input.payout });
    if ("rejected" in created) return created;
    await audit(tx, {
      adminId: ctx.adminId, action: "refund_request", targetType: "refund", targetId: created.refundId,
      after: { orderId: found.id, kind: "full", amountVnd: created.amountVnd }, result: "ok", reason, ip: ctx.ip,
    });
    return { refundId: created.refundId };
  });
  if ("rejected" in result) {
    await auditDenied({ adminId: ctx.adminId, action: "refund_request", targetType: "order", targetId: input.orderCode, reason: result.rejected, ip: ctx.ip });
  }
  return result;
}

/**
 * Học viên tự gửi yêu cầu hoàn tiền cho đơn đã thanh toán của mình (FR-28). Mức và điều kiện hoàn chưa chốt (G13):
 * không tự từ chối theo số ngày hay số bài, người duyệt quyết định. Báo nhóm kinh doanh, tin không kèm số tài khoản.
 */
export async function requestRefundAsLearner(
  ctx: LearnerCtx,
  input: { orderCode: string; reason: string; payout: Payout },
): Promise<{ refundId: string } | { rejected: FullRefundRejection | "not_found" }> {
  return withTx(async (tx) => {
    const group = await mergeGroupIds(tx, ctx.userId);
    const [found] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM orders WHERE code = ${input.orderCode} AND user_id = ANY(${group}::uuid[])`;
    if (!found) return { rejected: "not_found" as const };
    const created = await createFullRefund(tx, found.id, { reason: input.reason, requestedByUser: ctx.userId, payout: input.payout });
    if ("rejected" in created) return created;
    await enqueueOutbox(tx, {
      dedupKey: `refund_requested:${created.refundId}`, kind: "refund_requested", channel: "telegram",
      payload: { orderCode: created.orderCode, amountVnd: created.amountVnd },
    });
    return { refundId: created.refundId };
  });
}

/** Nhập hoặc sửa tài khoản nhận tiền khi yêu cầu còn ở bước “đề nghị” (hoàn phần thừa tự sinh khi ghép tay chưa có tài khoản). */
export async function setRefundPayout(ctx: AdminCtx, refundId: string, payout: Payout): Promise<"ok" | "invalid_transition" | "not_found"> {
  await authorize(ctx, "refunds.request", { action: "refund_payout", resource: { type: "refund", id: refundId } });
  const result = await withTx(async (tx) => {
    const [refund] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    if (!refund) return "not_found" as const;
    if (refund.status !== "requested") return "invalid_transition" as const;
    await tx.$executeRaw`
      UPDATE refunds SET payout_bank_name = ${payout.bankName}, payout_account_no = ${payout.accountNo}, payout_account_name = ${payout.accountName}
      WHERE id = ${refundId}::uuid`;
    await audit(tx, { adminId: ctx.adminId, action: "refund_payout", targetType: "refund", targetId: refundId, result: "ok", ip: ctx.ip });
    return "ok" as const;
  });
  if (result !== "ok") {
    await auditDenied({ adminId: ctx.adminId, action: "refund_payout", targetType: "refund", targetId: refundId, reason: result, ip: ctx.ip });
  }
  return result;
}

/** Đơn đã thanh toán hoặc đã hoàn của học viên (theo nhóm gộp), kèm yêu cầu hoàn gần nhất. */
export async function listMyOrdersForRefund(ctx: LearnerCtx) {
  const group = await mergeGroupIds(null, ctx.userId);
  const rows = await prisma().$queryRaw<{ code: string; status: string; amount_due_vnd: number; paid_at: Date | null; title_vi: string; refund_status: string | null; refund_at: Date | null }[]>`
    SELECT o.code, o.status, o.amount_due_vnd, o.paid_at, c.title_vi,
           r.status AS refund_status, r.requested_at AS refund_at
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id
    LEFT JOIN LATERAL (SELECT status, requested_at FROM refunds WHERE order_id = o.id AND kind = 'full' ORDER BY requested_at DESC LIMIT 1) r ON true
    WHERE o.user_id = ANY(${group}::uuid[]) AND o.status IN ('paid', 'refunded')
    ORDER BY o.paid_at DESC`;
  return rows.map((r) => ({
    code: r.code, status: r.status, amountVnd: r.amount_due_vnd, paidAt: r.paid_at, course: r.title_vi,
    refund: r.refund_status ? { status: r.refund_status, requestedAt: r.refund_at } : null,
  }));
}

export type RefundStep =
  | { action: "approve" }
  | { action: "send"; outBankRef: string; evidence: string }
  | { action: "confirm" }
  | { action: "fail"; reason: string }
  | { action: "cancel"; reason: string };

const NEXT: Record<RefundStep["action"], { from: string[]; to: string }> = {
  approve: { from: ["requested"], to: "approved" },
  send: { from: ["approved"], to: "sent" },
  confirm: { from: ["sent"], to: "confirmed" },
  fail: { from: ["sent"], to: "failed" },
  cancel: { from: ["requested", "approved"], to: "cancelled" },
};

export async function advanceRefund(
  ctx: AdminCtx,
  refundId: string,
  step: RefundStep,
): Promise<"ok" | "invalid_transition" | "not_found" | "duplicate_out_ref" | "missing_payout"> {
  await authorize(ctx, "refunds.approve", { action: `refund_${step.action}`, resource: { type: "refund", id: refundId } });
  const note = "reason" in step ? step.reason.trim() : undefined;
  if (note === "" || (step.action === "send" && (!step.outBankRef.trim() || !step.evidence.trim()))) {
    throw new HttpError(400, "Thiếu lý do, mã giao dịch chuyển trả hoặc bằng chứng");
  }
  const result = await withTx(async (tx) => {
    const [found] = await tx.$queryRaw<{ order_id: string }[]>`SELECT order_id FROM refunds WHERE id = ${refundId}::uuid`;
    if (!found) return "not_found";
    await tx.$queryRaw`
      SELECT bt.id FROM bank_transactions bt JOIN refund_sources rs ON rs.bank_transaction_id = bt.id
      WHERE rs.refund_id = ${refundId}::uuid ORDER BY bt.id FOR UPDATE OF bt`;
    const [order] = await tx.$queryRaw<{ id: string; code: string; user_id: string }[]>`
      SELECT id, code, user_id FROM orders WHERE id = ${found.order_id}::uuid FOR UPDATE`;
    const [refund] = await tx.$queryRaw<{ kind: "full" | "excess"; status: string; amount_vnd: number; payout_account_no: string | null }[]>`
      SELECT kind, status, amount_vnd, payout_account_no FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const move = NEXT[step.action];
    if (!move.from.includes(refund!.status)) return "invalid_transition";
    // BR-18: chỉ chuyển tiền về tài khoản học viên đã khai.
    if (step.action === "approve" && !refund!.payout_account_no) return "missing_payout";

    if (step.action === "approve") {
      await tx.$executeRaw`UPDATE refunds SET status = 'approved', approved_by = ${ctx.adminId}::uuid, approved_at = now() WHERE id = ${refundId}::uuid`;
    } else if (step.action === "send") {
      const ref = step.outBankRef.trim().toUpperCase();
      // Ràng buộc duy nhất trong DB là trọng tài (hai lệnh song song): lỗi trùng → duplicate_out_ref, không 500.
      await tx.$executeRaw`SAVEPOINT refund_send`;
      try {
        await tx.$executeRaw`
          UPDATE refunds SET status = 'sent', out_bank_ref = ${ref}, evidence = ${step.evidence.trim()}, sent_by = ${ctx.adminId}::uuid, sent_at = now()
          WHERE id = ${refundId}::uuid`;
      } catch (error) {
        if (!(error instanceof Error && error.message.includes("23505"))) throw error;
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT refund_send`;
        return "duplicate_out_ref";
      }
    } else if (step.action === "confirm") {
      await tx.$executeRaw`
        UPDATE refunds SET status = 'confirmed', confirmed_by = ${ctx.adminId}::uuid, confirmed_at = now(), closed_at = now()
        WHERE id = ${refundId}::uuid`;
      if (refund!.kind === "full") await refundOrder(tx, order!, refundId, refund!.amount_vnd);
    } else {
      await tx.$executeRaw`UPDATE refunds SET status = ${move.to}, closed_at = now() WHERE id = ${refundId}::uuid`;
    }
    await audit(tx, {
      adminId: ctx.adminId, action: `refund_${step.action}`, targetType: "refund", targetId: refundId,
      before: { status: refund!.status }, after: { status: move.to }, result: "ok", reason: note, ip: ctx.ip,
    });
    return "ok" as const;
  });
  if (result !== "ok") {
    await auditDenied({ adminId: ctx.adminId, action: `refund_${step.action}`, targetType: "refund", targetId: refundId, reason: result, ip: ctx.ip });
  }
  return result;
}

/** Hoàn toàn phần đã xác nhận: đơn → refunded, thu hồi đúng quyền học sinh ra từ đơn (tiến độ học giữ nguyên). */
async function refundOrder(tx: Tx, order: { id: string; code: string; user_id: string }, refundId: string, amountVnd: number) {
  await tx.$executeRaw`UPDATE orders SET status = 'refunded', refunded_at = now() WHERE id = ${order.id}::uuid`;
  await tx.$executeRaw`
    UPDATE enrollments SET revoked_at = now(), revoked_reason = ${`refund:${refundId}`}
    WHERE order_id = ${order.id}::uuid AND revoked_at IS NULL`;
  const payload = { orderId: order.id, orderCode: order.code, userId: order.user_id, amountVnd };
  for (const channel of ["telegram", "email"] as const) {
    await enqueueOutbox(tx, { dedupKey: `order_refunded:${order.id}:${channel}`, kind: "order_refunded", channel, payload });
  }
}
