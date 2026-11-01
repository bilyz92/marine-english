import { withTx, type Tx, type TxOptions } from "@/lib/db";
import { env } from "@/lib/env";
import { settleOrder } from "@/modules/enrollments/enroll";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import { classify, CLASSIFIER_VERSION, extractOrderCodes, type OrderStatus } from "./classifier";

// Đường duy nhất ghi tiền vào sổ (webhook, đối soát API, nhập sao kê) — TD §4.3. Một transaction; khóa dòng sổ trước, rồi đơn.

export type BankReport = {
  source: "sepay_webhook" | "sepay_api" | "manual";
  providerEventId?: string;
  bankCode: string;
  accountNo: string;
  bankRef: string | null;
  amountVnd: number;
  direction: "in" | "out";
  currency: string;
  content: string;
  bankTime: Date | null;
  raw: unknown;
  enteredBy?: string;
  evidence?: string;
  resolvesObservationId?: string;
};

export type IngestOutcome =
  | "ignored" | "unresolved" | "duplicate_event" | "mismatch" | "unverified" | "already_settled" | "queued" | "confirmed";

const isProvider = (source: BankReport["source"]) => source !== "manual";

function ignoredReason(r: BankReport): string | null {
  if (r.direction !== "in") return "outgoing";
  if (r.currency !== "VND") return "currency";
  if (!Number.isInteger(r.amountVnd) || r.amountVnd <= 0) return "amount";
  if (isProvider(r.source)) {
    const { SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO } = env();
    if (r.bankCode.toUpperCase() !== SEPAY_BANK_CODE || r.accountNo !== SEPAY_ACCOUNT_NO) return "other_account";
  }
  return null;
}

async function observe(
  tx: Tx,
  r: BankReport,
  extra: { bankTransactionId?: string; isFirst?: boolean; mismatch?: boolean; ignoredReason?: string; unresolvedReason?: string },
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO bank_transaction_observations
      (bank_transaction_id, source, provider_event_id, payload, is_first, mismatch, ignored_reason, unresolved_reason, resolves_observation_id)
    VALUES (${extra.bankTransactionId ?? null}::uuid, ${r.source}, ${r.providerEventId ?? null}, ${JSON.stringify(r.raw ?? null)}::jsonb,
            ${extra.isFirst ?? false}, ${extra.mismatch ?? false}, ${extra.ignoredReason ?? null}, ${extra.unresolvedReason ?? null},
            ${r.resolvesObservationId ?? null}::uuid)
    ON CONFLICT (source, provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING`;
  return inserted === 1;
}

export async function ingest(report: BankReport, opts: TxOptions = {}): Promise<IngestOutcome> {
  return withTx((tx) => ingestInTx(tx, report), opts);
}

/** Như ingest() nhưng chạy trong transaction của người gọi (nhập sao kê kèm nhật ký trong cùng transaction). */
export async function ingestInTx(tx: Tx, r: BankReport): Promise<IngestOutcome> {
  const ignored = ignoredReason(r);
  if (ignored) {
    return (await observe(tx, r, { ignoredReason: ignored })) ? "ignored" : "duplicate_event";
  }
  const bankRef = r.bankRef?.trim().toUpperCase() || null;
  if (!bankRef || !r.bankTime) {
    const reason = bankRef ? "missing_time" : "missing_ref";
    return (await observe(tx, r, { unresolvedReason: reason })) ? "unresolved" : "duplicate_event";
  }
  const bankCode = r.bankCode.trim().toUpperCase();
  const accountNo = r.accountNo.trim();

  const [created] = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source, entered_by, evidence, raw)
    VALUES (${bankCode}, ${accountNo}, ${bankRef}, ${r.amountVnd}, ${r.content}, ${r.bankTime}, ${r.source},
            ${r.enteredBy ?? null}::uuid, ${r.evidence ?? null}, ${JSON.stringify(r.raw ?? null)}::jsonb)
    ON CONFLICT (bank_code, account_no, bank_ref) DO NOTHING
    RETURNING id`;
  const [row] = await tx.$queryRaw<{ id: string; amount_vnd: number; bank_time: Date; content: string }[]>`
    SELECT id, amount_vnd, bank_time, content FROM bank_transactions
    WHERE bank_code = ${bankCode} AND account_no = ${accountNo} AND bank_ref = ${bankRef}
    FOR UPDATE`;
  const btId = row!.id;
  const isNew = created !== undefined;
  // Dòng cũ: so chính xác số tiền, thời điểm và các mã đơn trong nội dung (dòng nhập tay không được “xác minh hộ” nếu mã khác);
  // lệch thì cảnh báo chủ, không tự sửa, không xác minh.
  const sameCodes = (a: string, b: string) => extractOrderCodes(a).sort().join(",") === extractOrderCodes(b).sort().join(",");
  const mismatch =
    !isNew &&
    (row!.amount_vnd !== r.amountVnd || row!.bank_time.getTime() !== r.bankTime.getTime() || !sameCodes(row!.content, r.content));
  if (!(await observe(tx, r, { bankTransactionId: btId, isFirst: isNew, mismatch }))) return "duplicate_event";
  if (mismatch) {
    await enqueueOutbox(tx, {
      dedupKey: `ledger_mismatch:${btId}:${r.source}:${r.amountVnd}:${r.bankTime.toISOString()}`,
      kind: "ledger_mismatch",
      channel: "telegram",
      payload: { bankTransactionId: btId, source: r.source, reportedAmountVnd: r.amountVnd, ledgerAmountVnd: row!.amount_vnd },
    });
    return "mismatch";
  }
  if (isProvider(r.source)) {
    await tx.$executeRaw`
      INSERT INTO bank_transaction_verifications (bank_transaction_id, method)
      SELECT ${btId}::uuid, ${isNew ? "provider" : "provider_match"}
      WHERE NOT EXISTS (SELECT 1 FROM bank_transaction_verifications WHERE bank_transaction_id = ${btId}::uuid)`;
  }
  const [verified] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM bank_transaction_verifications WHERE bank_transaction_id = ${btId}::uuid) AS ok`;
  if (!verified!.ok) return "unverified";
  return classifyAndSettle(tx, btId);
}

/**
 * Bước 7–9 của TD §4.3 cho một dòng sổ đã xác minh và đang bị khóa: bỏ qua nếu đã xử lý; phân loại; tự xác nhận hoặc vào hàng chờ.
 * Xác minh tay của chủ (Task 8) gọi hàm này trong transaction của mình.
 */
export async function classifyAndSettle(tx: Tx, btId: string): Promise<IngestOutcome> {
  const [settled] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM payment_allocations WHERE bank_transaction_id = ${btId}::uuid)
        OR EXISTS (SELECT 1 FROM bank_transaction_dispositions WHERE bank_transaction_id = ${btId}::uuid AND superseded_at IS NULL)
        OR bank_transaction_refund_held(${btId}::uuid) AS ok`;
  if (settled!.ok) return "already_settled";

  const [bt] = await tx.$queryRaw<{ amount_vnd: number; bank_time: Date; content: string; now: Date }[]>`
    SELECT amount_vnd, bank_time, content, now() AS now FROM bank_transactions WHERE id = ${btId}::uuid`;
  const codes = extractOrderCodes(bt!.content);
  const [order] = codes.length === 1
    ? await tx.$queryRaw<{ id: string; code: string; status: OrderStatus; amount_due_vnd: number; created_at: Date; expires_at: Date }[]>`
        SELECT id, code, status, amount_due_vnd, created_at, expires_at FROM orders WHERE code = ${codes[0]!} FOR UPDATE`
    : [];
  const c = classify({
    amountVnd: bt!.amount_vnd,
    bankTime: bt!.bank_time,
    now: bt!.now,
    codes,
    order: order
      ? { id: order.id, status: order.status, amountDueVnd: order.amount_due_vnd, createdAt: order.created_at, expiresAt: order.expires_at }
      : null,
  });
  await tx.$executeRaw`
    INSERT INTO bank_transaction_classifications (bank_transaction_id, classifier_version, result, reason, candidate_codes, candidate_order_id)
    VALUES (${btId}::uuid, ${CLASSIFIER_VERSION}, ${c.result}, ${c.result === "queue" ? c.reason : null}, ${codes}::text[],
            ${order?.id ?? null}::uuid)`;
  if (c.result === "auto_confirm") {
    await settleOrder(tx, { orderId: order!.id, bankTransactionIds: [btId], kind: "auto" });
    return "confirmed";
  }
  await enqueueOutbox(tx, {
    dedupKey: `ledger_queued:${btId}`,
    kind: "ledger_queued",
    channel: "telegram",
    payload: { bankTransactionId: btId, reason: c.reason, amountVnd: bt!.amount_vnd, orderCode: order?.code ?? null },
  });
  return "queued";
}
