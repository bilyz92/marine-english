import { withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import type { AdminCtx } from "@/modules/sessions/guards";

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

export async function requestFullRefund(
  ctx: AdminCtx,
  input: { orderCode: string; reason: string },
): Promise<{ refundId: string } | { rejected: "not_paid" | "active_full_refund" }> {
  await authorize(ctx, "refunds.request", { action: "refund_request", resource: { type: "order", id: input.orderCode } });
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(400, "Cần lý do hoàn tiền");
  return withTx(async (tx) => {
    const [found] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${input.orderCode}`;
    if (!found) return { rejected: "not_paid" as const };
    const sources = await lockOrderSources(tx, found.id);
    const [order] = await tx.$queryRaw<{ status: string; amount_due_vnd: number }[]>`
      SELECT status, amount_due_vnd FROM orders WHERE id = ${found.id}::uuid FOR UPDATE`;
    if (order!.status !== "paid") return { rejected: "not_paid" as const };
    const [active] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM refunds WHERE order_id = ${found.id}::uuid AND kind = 'full' AND status NOT IN ('failed', 'cancelled')`;
    if (active) return { rejected: "active_full_refund" as const };

    const [refund] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO refunds (order_id, kind, amount_vnd, reason, requested_by)
      VALUES (${found.id}::uuid, 'full', ${order!.amount_due_vnd}, ${reason}, ${ctx.adminId}::uuid) RETURNING id`;
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
    await audit(tx, {
      adminId: ctx.adminId, action: "refund_request", targetType: "refund", targetId: refund!.id,
      after: { orderId: found.id, kind: "full", amountVnd: order!.amount_due_vnd }, result: "ok", reason, ip: ctx.ip,
    });
    return { refundId: refund!.id };
  });
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
): Promise<"ok" | "invalid_transition" | "not_found" | "duplicate_out_ref"> {
  await authorize(ctx, "refunds.approve", { action: `refund_${step.action}`, resource: { type: "refund", id: refundId } });
  const note = "reason" in step ? step.reason.trim() : undefined;
  if (note === "" || (step.action === "send" && (!step.outBankRef.trim() || !step.evidence.trim()))) {
    throw new HttpError(400, "Thiếu lý do, mã giao dịch chuyển trả hoặc bằng chứng");
  }
  return withTx(async (tx) => {
    const [found] = await tx.$queryRaw<{ order_id: string }[]>`SELECT order_id FROM refunds WHERE id = ${refundId}::uuid`;
    if (!found) return "not_found";
    await tx.$queryRaw`
      SELECT bt.id FROM bank_transactions bt JOIN refund_sources rs ON rs.bank_transaction_id = bt.id
      WHERE rs.refund_id = ${refundId}::uuid ORDER BY bt.id FOR UPDATE OF bt`;
    const [order] = await tx.$queryRaw<{ id: string; code: string; user_id: string }[]>`
      SELECT id, code, user_id FROM orders WHERE id = ${found.order_id}::uuid FOR UPDATE`;
    const [refund] = await tx.$queryRaw<{ kind: "full" | "excess"; status: string; amount_vnd: number }[]>`
      SELECT kind, status, amount_vnd FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
    const move = NEXT[step.action];
    if (!move.from.includes(refund!.status)) return "invalid_transition";

    if (step.action === "approve") {
      await tx.$executeRaw`UPDATE refunds SET status = 'approved', approved_by = ${ctx.adminId}::uuid, approved_at = now() WHERE id = ${refundId}::uuid`;
    } else if (step.action === "send") {
      const ref = step.outBankRef.trim().toUpperCase();
      const [taken] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refunds WHERE out_bank_ref = ${ref}`;
      if (taken) return "duplicate_out_ref";
      await tx.$executeRaw`
        UPDATE refunds SET status = 'sent', out_bank_ref = ${ref}, evidence = ${step.evidence.trim()}, sent_by = ${ctx.adminId}::uuid, sent_at = now()
        WHERE id = ${refundId}::uuid`;
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
    return "ok";
  });
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
