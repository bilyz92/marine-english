import { z } from "zod";
import { withTx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { classifyAndSettle, ingestInTx, type IngestOutcome } from "./ingest";

// Nhập sao kê (khi SePay chưa sẵn sàng hoặc bỏ sót) và chủ xác minh — DG §2.1, TD §4.5.

export const StatementLine = z.object({
  bankCode: z.string().regex(/^[A-Z0-9]{2,20}$/),
  accountNo: z.string().regex(/^[0-9]{4,30}$/),
  bankRef: z.string().trim().min(1).max(100),
  amountVnd: z.number().int().positive(),
  // Bắt buộc có múi giờ (ví dụ +07:00) để không hiểu nhầm theo giờ máy chủ.
  bankTime: z.union([z.date(), z.iso.datetime({ offset: true }).transform((v) => new Date(v))]),
  content: z.string().max(1000),
  evidence: z.string().trim().min(1).max(2000),
  resolvesObservationId: z.uuid().optional(),
});
export type StatementLineInput = z.input<typeof StatementLine>;

export async function enterStatementLine(ctx: AdminCtx, input: StatementLineInput): Promise<IngestOutcome> {
  await authorize(ctx, "ledger.enter", { action: "ledger_enter" });
  const parsed = StatementLine.safeParse(input);
  if (!parsed.success) throw new HttpError(400, "Dòng sao kê không hợp lệ");
  const line = parsed.data;
  // Chỉ nhận dòng của đúng tài khoản SePay theo dõi, để cùng một khoản tiền không vào sổ hai lần với hai định danh khác nhau.
  const { SEPAY_BANK_CODE, SEPAY_ACCOUNT_NO } = env();
  if ((SEPAY_BANK_CODE && line.bankCode !== SEPAY_BANK_CODE) || (SEPAY_ACCOUNT_NO && line.accountNo !== SEPAY_ACCOUNT_NO)) {
    throw new HttpError(400, "Tài khoản nhận không khớp tài khoản đã cấu hình");
  }
  return withTx(async (tx) => {
    const outcome = await ingestInTx(tx, {
      source: "manual",
      bankCode: line.bankCode,
      accountNo: line.accountNo,
      bankRef: line.bankRef,
      amountVnd: line.amountVnd,
      direction: "in",
      currency: "VND",
      content: line.content,
      bankTime: line.bankTime,
      raw: null,
      enteredBy: ctx.adminId,
      evidence: line.evidence,
      resolvesObservationId: line.resolvesObservationId,
    });
    await audit(tx, {
      adminId: ctx.adminId, action: "ledger_enter", targetType: "bank_transaction", targetId: line.bankRef,
      // Không ghi nội dung chuyển khoản hay bằng chứng vào nhật ký (đã nằm trong dòng sổ).
      after: { bankRef: line.bankRef, amountVnd: line.amountVnd, bankTime: line.bankTime.toISOString(), outcome, evidenceProvided: true },
      result: "ok", ip: ctx.ip,
    });
    return outcome;
  });
}

export type VerifyResult =
  | { result: "verified"; outcome: IngestOutcome }
  | { result: "already_verified" | "self_entered" | "not_found" };

/** Chủ xác minh dòng nhập tay: khóa dòng sổ trước, người xác minh khác người nhập, rồi phân loại/ghi nhận như mọi nguồn. */
export async function verifyStatementLine(ctx: AdminCtx, bankTransactionId: string, evidence: string): Promise<VerifyResult> {
  await authorize(ctx, "ledger.verify", { action: "ledger_verify", resource: { type: "bank_transaction", id: bankTransactionId } });
  if (!evidence.trim()) throw new HttpError(400, "Cần bằng chứng xác minh");
  const result = await withTx(async (tx): Promise<VerifyResult> => {
    const [bt] = await tx.$queryRaw<{ entered_by: string | null; verified: boolean }[]>`
      SELECT entered_by,
             EXISTS (SELECT 1 FROM bank_transaction_verifications v WHERE v.bank_transaction_id = bt.id) AS verified
      FROM bank_transactions bt WHERE id = ${bankTransactionId}::uuid FOR UPDATE`;
    if (!bt) return { result: "not_found" };
    if (bt.verified) return { result: "already_verified" };
    if (bt.entered_by === ctx.adminId) return { result: "self_entered" };
    await tx.$executeRaw`
      INSERT INTO bank_transaction_verifications (bank_transaction_id, method, verified_by, evidence)
      VALUES (${bankTransactionId}::uuid, 'owner', ${ctx.adminId}::uuid, ${evidence.trim()})`;
    const outcome = await classifyAndSettle(tx, bankTransactionId);
    await audit(tx, {
      adminId: ctx.adminId, action: "ledger_verify", targetType: "bank_transaction", targetId: bankTransactionId,
      after: { outcome }, result: "ok", reason: evidence.trim(), ip: ctx.ip,
    });
    return { result: "verified", outcome };
  });
  if (result.result !== "verified") {
    await auditDenied({
      adminId: ctx.adminId, action: "ledger_verify", targetType: "bank_transaction", targetId: bankTransactionId,
      reason: result.result, ip: ctx.ip,
    });
  }
  return result;
}
