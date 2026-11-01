import { prisma } from "@/lib/db";
import type { QueueReason } from "./classifier";

// Hàng chờ xử lý tay (TD §4.7): dòng sổ chưa phân bổ, chưa có kết luận hiệu lực, chưa có đề nghị hoàn còn hiệu lực,
// kèm lần phân loại gần nhất.

export type QueueRow = {
  bankTransactionId: string;
  bankTime: Date;
  amountVnd: number;
  /** Nội dung chuyển khoản gốc; null khi người xem không có quyền xem dữ liệu ngân hàng thô. */
  content: string | null;
  source: string;
  reason: QueueReason | "unverified";
  candidateCodes: string[];
  candidateOrderCode: string | null;
};

type Row = {
  id: string; bank_time: Date; amount_vnd: number; content: string; source: string; verified: boolean;
  reason: QueueReason | null; candidate_codes: string[] | null; candidate_order_id: string | null; candidate_order_code: string | null;
};

async function openRows(): Promise<Row[]> {
  return prisma().$queryRaw<Row[]>`
    SELECT bt.id, bt.bank_time, bt.amount_vnd, bt.content, bt.source,
           EXISTS (SELECT 1 FROM bank_transaction_verifications v WHERE v.bank_transaction_id = bt.id) AS verified,
           lc.reason, lc.candidate_codes, lc.candidate_order_id, o.code AS candidate_order_code
    FROM bank_transactions bt
    LEFT JOIN LATERAL (
      SELECT reason, candidate_codes, candidate_order_id FROM bank_transaction_classifications c
      WHERE c.bank_transaction_id = bt.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1
    ) lc ON TRUE
    LEFT JOIN orders o ON o.id = lc.candidate_order_id
    WHERE NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.bank_transaction_id = bt.id)
      AND NOT EXISTS (SELECT 1 FROM bank_transaction_dispositions d WHERE d.bank_transaction_id = bt.id AND d.superseded_at IS NULL)
      AND NOT bank_transaction_refund_held(bt.id)
    ORDER BY bt.bank_time, bt.id`;
}

export async function listQueue(opts: { raw: boolean } = { raw: true }): Promise<QueueRow[]> {
  return (await openRows()).map((r) => ({
    bankTransactionId: r.id,
    bankTime: r.bank_time,
    amountVnd: r.amount_vnd,
    content: opts.raw ? r.content : null,
    source: r.source,
    reason: r.verified ? (r.reason ?? "unverified") : "unverified",
    candidateCodes: r.candidate_codes ?? [],
    candidateOrderCode: r.candidate_order_code,
  }));
}

/** Cờ “cần xử lý tay” của đơn: có giao dịch đang chờ mà lần phân loại gần nhất trỏ tới đơn, kể cả khi nội dung ghi nhiều mã. */
export async function orderNeedsManual(orderId: string, orderCode: string): Promise<boolean> {
  return (await openRows()).some((r) => r.candidate_order_id === orderId || (r.candidate_codes ?? []).includes(orderCode));
}

export type UnresolvedRow = { observationId: string; source: string; reason: "missing_ref" | "missing_time"; receivedAt: Date; payload?: unknown };

/** Báo cáo thiếu mã tham chiếu/thời điểm chưa được dòng nhập tay nào giải quyết. */
export async function listUnresolved(opts: { raw: boolean } = { raw: true }): Promise<UnresolvedRow[]> {
  const rows = await prisma().$queryRaw<{ id: string; source: string; unresolved_reason: "missing_ref" | "missing_time"; received_at: Date; payload: unknown }[]>`
    SELECT o.id, o.source, o.unresolved_reason, o.received_at, o.payload FROM bank_transaction_observations o
    WHERE o.unresolved_reason IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM bank_transaction_observations r WHERE r.resolves_observation_id = o.id)
    ORDER BY o.received_at`;
  return rows.map((r) => ({
    observationId: r.id, source: r.source, reason: r.unresolved_reason, receivedAt: r.received_at,
    ...(opts.raw ? { payload: r.payload } : {}),
  }));
}
