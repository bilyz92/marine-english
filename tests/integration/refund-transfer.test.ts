import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { classifyAndSettle, ingest } from "@/modules/ledger/ingest";
import { enterStatementLine } from "@/modules/ledger/manual";
import { matchTransfers, setDisposition } from "@/modules/ledger/match";
import { listQueue, orderNeedsManual } from "@/modules/ledger/queue";
import { advanceRefund, requestTransferRefund } from "@/modules/refunds/refunds";
import { auditRows } from "../helpers/admin";
import { adminCtx } from "../helpers/admin-ctx";
import { paidCourseSetup, PRICE, report, TEST_PAYOUT } from "../helpers/ledger";

// Hoàn một khoản chuyển đang nằm hàng chờ, chưa ghép vào đơn nào (UC-09 khách chuyển thiếu/sai; UC-10 “cần xử lý tay”).

async function queuedTx(amountVnd: number, content = "chuyen tien hoc phi") {
  const r = report({ amountVnd, content });
  expect(await ingest(r)).toBe("queued");
  return (await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: r.bankRef! } })).id;
}

const evidence = { note: "khách gửi ảnh", evidence: "ảnh zalo" };

describe("hoàn khoản chuyển chưa ghép", () => {
  it("đề nghị → rời hàng chờ, không ghép hay kết luận được nữa; đi đủ 4 bước mà không đụng đơn nào", async () => {
    await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(150_000);
    const created = await requestTransferRefund(owner, { bankTransactionId: tx, reason: "khách chuyển thiếu, xin trả lại" });
    if (!("refundId" in created)) throw new Error(JSON.stringify(created));

    const refund = await prisma().refund.findUniqueOrThrow({ where: { id: created.refundId }, include: { sources: true } });
    expect(refund).toMatchObject({ kind: "unallocated", orderId: null, amountVnd: 150_000, status: "requested" });
    expect(refund.sources).toEqual([expect.objectContaining({ bankTransactionId: tx, amountVnd: 150_000 })]);
    expect(await listQueue()).toEqual([]);
    expect(await matchTransfers(owner, { orderCode: (await prisma().order.findFirstOrThrow()).code, bankTransactionIds: [tx], ...evidence }))
      .toEqual({ result: "rejected", reason: "already_settled" });
    expect(await setDisposition(owner, tx, { kind: "ignored", reason: "x" })).toBe("already_settled");

    expect(await advanceRefund(owner, created.refundId, { action: "approve" })).toBe("missing_payout");
    await prisma().refund.update({ where: { id: created.refundId }, data: { payoutBankName: TEST_PAYOUT.bankName, payoutAccountNo: TEST_PAYOUT.accountNo, payoutAccountName: TEST_PAYOUT.accountName } });
    expect(await advanceRefund(owner, created.refundId, { action: "approve" })).toBe("ok");
    expect(await advanceRefund(owner, created.refundId, { action: "send", outBankRef: "OUT1", evidence: "ủy nhiệm chi" })).toBe("ok");
    expect(await advanceRefund(owner, created.refundId, { action: "confirm" })).toBe("ok");
    expect(await prisma().order.findFirstOrThrow()).toMatchObject({ status: "pending" });
    expect(await prisma().enrollment.count()).toBe(0);
    expect(await listQueue()).toEqual([]);
    expect((await auditRows("refund_request")).map((r) => [r.result, r.target_id])).toEqual([["ok", created.refundId]]);
  });

  it("hủy đề nghị → khoản quay lại hàng chờ và ghép được", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE);
    const created = await requestTransferRefund(owner, { bankTransactionId: tx, reason: "nhầm", payout: TEST_PAYOUT });
    if (!("refundId" in created)) throw new Error(JSON.stringify(created));
    expect(await advanceRefund(owner, created.refundId, { action: "cancel", reason: "khách muốn giữ học" })).toBe("ok");
    expect((await listQueue()).map((r) => r.bankTransactionId)).toEqual([tx]);
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "paid" });
  });

  it("từ chối: đã ghép, đã kết luận, đang có đề nghị, chưa xác minh, không tồn tại; ghi nhật ký từ chối", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const support = await adminCtx("support");
    const matched = await queuedTx(PRICE);
    await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [matched], ...evidence });
    const ignored = await queuedTx(10_000);
    await setDisposition(owner, ignored, { kind: "ignored", reason: "thử" });
    const pending = await queuedTx(20_000);
    expect(await requestTransferRefund(support, { bankTransactionId: pending, reason: "trả" })).toHaveProperty("refundId");
    await enterStatementLine(support, { bankCode: "VCB", accountNo: "0123456789", bankRef: "ST9", amountVnd: 5_000, bankTime: new Date(), content: "", evidence: "x" });
    const unverified = (await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: "ST9" } })).id;

    for (const id of [matched, ignored, pending]) {
      expect(await requestTransferRefund(owner, { bankTransactionId: id, reason: "trả" })).toEqual({ rejected: "already_settled" });
    }
    expect(await requestTransferRefund(owner, { bankTransactionId: unverified, reason: "trả" })).toEqual({ rejected: "not_verified" });
    expect(await requestTransferRefund(owner, { bankTransactionId: "00000000-0000-4000-8000-000000000000", reason: "trả" })).toEqual({ rejected: "not_found" });
    expect((await auditRows("refund_request")).filter((r) => r.result === "denied").map((r) => r.reason))
      .toEqual(["already_settled", "already_settled", "already_settled", "not_verified", "not_found"]);
  });

  it("đơn hết cờ “cần xử lý tay” khi khoản chuyển sai số tiền của nó đã có đề nghị hoàn", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE - 50_000, `HP ${s.code}`);
    expect(await orderNeedsManual(s.orderId, s.code)).toBe(true);
    await requestTransferRefund(owner, { bankTransactionId: tx, reason: "chuyển thiếu, trả lại" });
    expect(await orderNeedsManual(s.orderId, s.code)).toBe(false);
  });

  it("phân loại lại một khoản đang có đề nghị hoàn → already_settled, không tự ghép", async () => {
    await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE, "khong ma");
    await requestTransferRefund(owner, { bankTransactionId: tx, reason: "trả" });
    expect(await withTx((t) => classifyAndSettle(t, tx))).toBe("already_settled");
    expect(await prisma().paymentAllocation.count()).toBe(0);
  });

  it("CSDL chặn: phân bổ hay kết luận cho dòng đang có đề nghị hoàn; đổi order_id của refund", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE);
    const created = await requestTransferRefund(owner, { bankTransactionId: tx, reason: "trả" });
    if (!("refundId" in created)) throw new Error("no refund");
    await expect(prisma().$executeRaw`
      INSERT INTO payment_allocations (bank_transaction_id, order_id, amount_vnd, kind)
      VALUES (${tx}::uuid, ${s.orderId}::uuid, ${PRICE}, 'auto')`).rejects.toThrow(/settlement_conflict/);
    await expect(prisma().$executeRaw`
      INSERT INTO bank_transaction_dispositions (bank_transaction_id, kind, reason, decided_by)
      VALUES (${tx}::uuid, 'ignored', 'x', ${owner.adminId}::uuid)`).rejects.toThrow(/settlement_conflict/);
    await expect(prisma().$executeRaw`UPDATE refunds SET order_id = ${s.orderId}::uuid WHERE id = ${created.refundId}::uuid`).rejects.toThrow(/refund_immutable/);
  });
});
