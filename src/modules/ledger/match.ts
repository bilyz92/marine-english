import { withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import { settleOrder } from "@/modules/enrollments/enroll";
import type { AdminCtx } from "@/modules/sessions/guards";

// Ghép tay và kết luận — DG §2.8, TD §4.5. Khóa các dòng sổ (id tăng dần) rồi mới khóa đơn.

export type MatchResult =
  | { result: "paid" | "paid_with_excess_refund" | "short" }
  | { result: "rejected"; reason: "not_verified" | "already_settled" | "order_refunded" | "order_paid" | "not_found" };

type LedgerRow = { id: string; amount_vnd: number; bank_time: Date; verified: boolean; settled: boolean };

/** Thao tác chỉ chủ được làm (dù quyền chung cho cả hỗ trợ): ghi nhật ký từ chối rồi 403. */
async function requireOwnerFor(ctx: AdminCtx, action: string, targetType: string, targetId: string | null): Promise<void> {
  if (ctx.role === "owner") return;
  await auditDenied({ adminId: ctx.adminId, action, targetType, targetId, reason: "role", ip: ctx.ip });
  throw new HttpError(403, "role");
}

export async function matchTransfers(
  ctx: AdminCtx,
  input: { orderCode: string; bankTransactionIds: string[]; note: string; evidence: string },
): Promise<MatchResult> {
  await authorize(ctx, "payments.match", { action: "ledger_match", resource: { type: "order", id: input.orderCode } });
  const ids = [...new Set(input.bankTransactionIds)].sort();
  if (ids.length === 0 || ids.length > 10 || !input.note.trim() || !input.evidence.trim()) {
    throw new HttpError(400, "Cần 1–10 giao dịch, ghi chú và bằng chứng");
  }
  // Chuyển bù (nhiều giao dịch cho một đơn) chỉ chủ được ghép.
  if (ids.length > 1) await requireOwnerFor(ctx, "ledger_match", "order", input.orderCode);

  const result = await withTx(async (tx): Promise<MatchResult> => {
    const rows = await tx.$queryRaw<LedgerRow[]>`
      SELECT bt.id, bt.amount_vnd, bt.bank_time,
             EXISTS (SELECT 1 FROM bank_transaction_verifications v WHERE v.bank_transaction_id = bt.id) AS verified,
             EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.bank_transaction_id = bt.id)
               OR EXISTS (SELECT 1 FROM bank_transaction_dispositions d WHERE d.bank_transaction_id = bt.id AND d.superseded_at IS NULL) AS settled
      FROM bank_transactions bt WHERE bt.id = ANY(${ids}::uuid[]) ORDER BY bt.id FOR UPDATE`;
    if (rows.length !== ids.length) return { result: "rejected", reason: "not_found" };
    if (rows.some((r) => r.settled)) return { result: "rejected", reason: "already_settled" };
    if (rows.some((r) => !r.verified)) return { result: "rejected", reason: "not_verified" };
    const [order] = await tx.$queryRaw<{ id: string; status: string; amount_due_vnd: number }[]>`
      SELECT id, status, amount_due_vnd FROM orders WHERE code = ${input.orderCode} FOR UPDATE`;
    if (!order) return { result: "rejected", reason: "not_found" };
    if (order.status === "paid") return { result: "rejected", reason: "order_paid" };
    if (order.status === "refunded") return { result: "rejected", reason: "order_refunded" };

    const total = rows.reduce((sum, r) => sum + r.amount_vnd, 0);
    const entry = {
      adminId: ctx.adminId, action: "ledger_match", targetType: "order", targetId: order.id, ip: ctx.ip, reason: input.note.trim(),
      before: { status: order.status, amountDueVnd: order.amount_due_vnd },
    };
    if (total < order.amount_due_vnd) {
      await audit(tx, { ...entry, after: { outcome: "short", totalVnd: total, shortVnd: order.amount_due_vnd - total, evidence: input.evidence, bankTransactionIds: ids }, result: "ok" });
      return { result: "short" };
    }
    await settleOrder(tx, { orderId: order.id, bankTransactionIds: ids, kind: "manual", allocatedBy: ctx.adminId });
    const excess = total - order.amount_due_vnd;
    if (excess > 0) await requestExcessRefund(tx, ctx, order.id, rows, excess);
    await audit(tx, {
      ...entry,
      after: { status: "paid", totalVnd: total, excessVnd: excess, evidence: input.evidence, bankTransactionIds: ids },
      result: "ok",
    });
    return { result: excess > 0 ? "paid_with_excess_refund" : "paid" };
  });
  if (result.result === "rejected") {
    await auditDenied({ adminId: ctx.adminId, action: "ledger_match", targetType: "order", targetId: input.orderCode, reason: result.reason, ip: ctx.ip });
  }
  return result;
}

/** Phần thừa phải hoàn: nguồn lấy từ dòng sổ có bank_time muộn nhất trước (quy tắc cố định để lặp lại được). */
async function requestExcessRefund(tx: Parameters<Parameters<typeof withTx>[0]>[0], ctx: AdminCtx, orderId: string, rows: LedgerRow[], excess: number) {
  const [refund] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO refunds (order_id, kind, amount_vnd, reason, requested_by)
    VALUES (${orderId}::uuid, 'excess', ${excess}, 'Hoàn phần thừa khi ghép tay', ${ctx.adminId}::uuid) RETURNING id`;
  let remaining = excess;
  const latestFirst = [...rows].sort((a, b) => b.bank_time.getTime() - a.bank_time.getTime() || b.id.localeCompare(a.id));
  for (const row of latestFirst) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, row.amount_vnd);
    await tx.$executeRaw`
      INSERT INTO refund_sources (refund_id, bank_transaction_id, amount_vnd) VALUES (${refund!.id}::uuid, ${row.id}::uuid, ${amount})`;
    remaining -= amount;
  }
}

/** Kết luận cho dòng sổ không ghép được (bỏ qua / trùng). Chỉ chủ. Kết luận mới thay kết luận cũ, có nhật ký. */
export async function setDisposition(
  ctx: AdminCtx,
  bankTransactionId: string,
  input: { kind: "duplicate" | "ignored"; reason: string },
): Promise<"ok" | "already_settled" | "not_found"> {
  await authorize(ctx, "payments.match", { action: "ledger_disposition", resource: { type: "bank_transaction", id: bankTransactionId } });
  await requireOwnerFor(ctx, "ledger_disposition", "bank_transaction", bankTransactionId);
  if (!input.reason.trim()) throw new HttpError(400, "Cần lý do");
  const result = await withTx(async (tx) => {
    const [bt] = await tx.$queryRaw<{ allocated: boolean; previous: string | null }[]>`
      SELECT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.bank_transaction_id = bt.id) AS allocated,
             (SELECT kind FROM bank_transaction_dispositions d WHERE d.bank_transaction_id = bt.id AND d.superseded_at IS NULL) AS previous
      FROM bank_transactions bt WHERE bt.id = ${bankTransactionId}::uuid FOR UPDATE`;
    if (!bt) return "not_found";
    if (bt.allocated) return "already_settled";
    await tx.$executeRaw`
      UPDATE bank_transaction_dispositions SET superseded_at = now()
      WHERE bank_transaction_id = ${bankTransactionId}::uuid AND superseded_at IS NULL`;
    await tx.$executeRaw`
      INSERT INTO bank_transaction_dispositions (bank_transaction_id, kind, reason, decided_by)
      VALUES (${bankTransactionId}::uuid, ${input.kind}, ${input.reason.trim()}, ${ctx.adminId}::uuid)`;
    await audit(tx, {
      adminId: ctx.adminId, action: "ledger_disposition", targetType: "bank_transaction", targetId: bankTransactionId,
      before: { kind: bt.previous }, after: { kind: input.kind }, result: "ok", reason: input.reason.trim(), ip: ctx.ip,
    });
    return "ok" as const;
  });
  if (result !== "ok") {
    await auditDenied({ adminId: ctx.adminId, action: "ledger_disposition", targetType: "bank_transaction", targetId: bankTransactionId, reason: result, ip: ctx.ip });
  }
  return result;
}

/** Mở lại giao dịch đã có kết luận (bỏ qua/trùng) để ghép hoặc xử lý tiếp. Chỉ chủ; kết luận cũ được đánh dấu thay thế. */
export async function reopenTransfer(ctx: AdminCtx, bankTransactionId: string, reason: string): Promise<"ok" | "not_found"> {
  await authorize(ctx, "payments.match", { action: "ledger_reopen", resource: { type: "bank_transaction", id: bankTransactionId } });
  await requireOwnerFor(ctx, "ledger_reopen", "bank_transaction", bankTransactionId);
  if (!reason.trim()) throw new HttpError(400, "Cần lý do");
  const result = await withTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${bankTransactionId}::uuid FOR UPDATE`;
    const [previous] = await tx.$queryRaw<{ kind: string }[]>`
      UPDATE bank_transaction_dispositions SET superseded_at = now()
      WHERE bank_transaction_id = ${bankTransactionId}::uuid AND superseded_at IS NULL RETURNING kind`;
    if (!previous) return "not_found";
    await audit(tx, {
      adminId: ctx.adminId, action: "ledger_reopen", targetType: "bank_transaction", targetId: bankTransactionId,
      before: { kind: previous.kind }, after: { kind: null }, result: "ok", reason: reason.trim(), ip: ctx.ip,
    });
    return "ok" as const;
  });
  if (result !== "ok") {
    await auditDenied({ adminId: ctx.adminId, action: "ledger_reopen", targetType: "bank_transaction", targetId: bankTransactionId, reason: result, ip: ctx.ip });
  }
  return result;
}
