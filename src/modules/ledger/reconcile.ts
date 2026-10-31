import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { withFence, type Lease } from "@/modules/jobs/lease";
import { ingestInTx, type IngestOutcome } from "./ingest";
import { toBankReport } from "./sepay";

const PROVIDER = "sepay";
const OVERLAP_MS = 2 * 3_600_000;

export interface SepayApi {
  listTransactions(input: { from: Date; cursor?: string }): Promise<{ items: unknown[]; nextCursor?: string }>;
}

export type ReconcileResult = { pages: number; ingested: number; outcomes: Partial<Record<IngestOutcome, number>> };

/** API liệt kê giao dịch của SePay: chờ cổng G4 (chưa rõ có API, phân trang, giới hạn gọi); chưa có thì job bỏ qua. */
export function sepayApi(): SepayApi | null {
  return null;
}

/**
 * Đọc lại từ con trỏ lùi 2 giờ, đưa từng giao dịch qua cùng bộ ingest với webhook (trùng thì bỏ qua),
 * và chỉ dời con trỏ sau khi hết trang. Lần đầu chỉ đọc 2 giờ gần nhất để không kéo tiền cũ trước khi mở bán vào hàng chờ.
 */
export async function reconcile(api: SepayApi, lease: Lease, signal: AbortSignal): Promise<ReconcileResult> {
  const { SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO } = env();
  const key = { provider: PROVIDER, bankCode: SEPAY_BANK_CODE!, accountNo: SEPAY_ACCOUNT_NO! };
  const startedAt = new Date();
  const saved = await prisma().reconciliationCursor.findUnique({ where: { provider_bankCode_accountNo: key } });
  const from = new Date((saved?.lastCompleteBankTime ?? startedAt).getTime() - OVERLAP_MS);

  const result: ReconcileResult = { pages: 0, ingested: 0, outcomes: {} };
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await api.listTransactions({ from, cursor });
    result.pages++;
    for (const item of page.items) {
      signal.throwIfAborted();
      const report = toBankReport(item, "sepay_api");
      if (!report) throw new Error("sepay_item_malformed");
      // Mỗi giao dịch có thể chốt đơn và mở quyền học nên chạy dưới fence: worker mất lease không ghi được gì.
      const outcome = await withFence(lease, (tx) => ingestInTx(tx, report));
      result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
      result.ingested++;
    }
    cursor = page.nextCursor;
  } while (cursor);

  await withFence(lease, (tx) => tx.$executeRaw`
    INSERT INTO reconciliation_cursors (provider, bank_code, account_no, last_complete_bank_time)
    VALUES (${key.provider}, ${key.bankCode}, ${key.accountNo}, ${startedAt})
    ON CONFLICT (provider, bank_code, account_no) DO UPDATE
      SET last_complete_bank_time = GREATEST(reconciliation_cursors.last_complete_bank_time, EXCLUDED.last_complete_bank_time), updated_at = now()`);
  return result;
}
