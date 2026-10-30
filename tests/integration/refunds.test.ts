import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { ingest } from "@/modules/ledger/ingest";
import { matchTransfers } from "@/modules/ledger/match";
import { advanceRefund, requestFullRefund } from "@/modules/refunds/refunds";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { paidCourseSetup, PRICE, report } from "../helpers/ledger";

async function paid() {
  const s = await paidCourseSetup();
  expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
  const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_tanker" } });
  return { ...s, courseId: course.id };
}

async function runToConfirmed(owner: Awaited<ReturnType<typeof adminCtx>>, refundId: string, ref = "OUT-1") {
  expect(await advanceRefund(owner, refundId, { action: "approve" })).toBe("ok");
  expect(await advanceRefund(owner, refundId, { action: "send", outBankRef: ref, evidence: "ảnh chuyển trả" })).toBe("ok");
  expect(await advanceRefund(owner, refundId, { action: "confirm" })).toBe("ok");
}

describe("hoàn tiền toàn phần", () => {
  it("đề nghị → duyệt → chuyển → xác nhận: đơn refunded, quyền học bị thu hồi, outbox, audit", async () => {
    const s = await paid();
    const support = await adminCtx("support");
    const owner = await adminCtx("owner");
    const r = await requestFullRefund(support, { orderCode: s.code, reason: "khách đổi ý trong 7 ngày" });
    if (!("refundId" in r)) throw new Error(JSON.stringify(r));
    await runToConfirmed(owner, r.refundId);
    expect(await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).toMatchObject({ status: "refunded" });
    expect(await hasCourseAccess(s.learner.userId, s.courseId)).toBe(false);
    const enrollment = await prisma().enrollment.findFirstOrThrow({ where: { orderId: s.orderId } });
    expect(enrollment.revokedReason).toBe(`refund:${r.refundId}`);
    expect((await prisma().outboxEvent.findMany({ where: { kind: "order_refunded" } })).length).toBe(2);
    expect((await auditRows()).filter((a) => a.action.startsWith("refund_")).map((a) => a.action)).toEqual([
      "refund_request", "refund_approve", "refund_send", "refund_confirm",
    ]);
  });

  it("đề nghị lần hai khi lần một chưa đóng → active_full_refund; đơn chưa paid → not_paid", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    expect(await requestFullRefund(owner, { orderCode: s.code, reason: "x" })).toHaveProperty("refundId");
    expect(await requestFullRefund(owner, { orderCode: s.code, reason: "x" })).toEqual({ rejected: "active_full_refund" });
    expect(await requestFullRefund(owner, { orderCode: "MEAAAAAAAA", reason: "x" })).toEqual({ rejected: "not_paid" });
  });

  it("bước sai thứ tự → invalid_transition; trùng out_bank_ref → duplicate_out_ref; support duyệt → 403", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    const support = await adminCtx("support");
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "x" });
    if (!("refundId" in r)) throw new Error();
    expect(await advanceRefund(owner, r.refundId, { action: "confirm" })).toBe("invalid_transition");
    expect(await rejected(advanceRefund(support, r.refundId, { action: "approve" }))).toBe("role");
    await advanceRefund(owner, r.refundId, { action: "approve" });
    await advanceRefund(owner, r.refundId, { action: "send", outBankRef: "OUT-9", evidence: "x" });
    expect(await advanceRefund(owner, r.refundId, { action: "fail", reason: "ngân hàng trả lại" })).toBe("ok");
    expect(await hasCourseAccess(s.learner.userId, s.courseId)).toBe(true);
    const again = await requestFullRefund(owner, { orderCode: s.code, reason: "thử lại" });
    if (!("refundId" in again)) throw new Error();
    await advanceRefund(owner, again.refundId, { action: "approve" });
    expect(await advanceRefund(owner, again.refundId, { action: "send", outBankRef: "OUT-9", evidence: "x" })).toBe("duplicate_out_ref");
    expect(await advanceRefund(owner, crypto.randomUUID(), { action: "approve" })).toBe("not_found");
  });
});

describe("hoàn phần thừa", () => {
  it("excess xác nhận → đơn vẫn paid, quyền còn; sau đó hoàn toàn phần dùng phần tiền còn lại của dòng sổ", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const r = report({ content: "khong ma", amountVnd: PRICE + 50_000 });
    expect(await ingest(r)).toBe("queued");
    const tx = (await prisma().bankTransaction.findFirstOrThrow()).id;
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], note: "x", evidence: "y" })).toEqual({ result: "paid_with_excess_refund" });
    const excess = await prisma().refund.findFirstOrThrow({ where: { kind: "excess" } });
    await runToConfirmed(owner, excess.id, "OUT-EX");
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
    const full = await requestFullRefund(owner, { orderCode: s.code, reason: "hoàn nốt" });
    if (!("refundId" in full)) throw new Error(JSON.stringify(full));
    await runToConfirmed(owner, full.refundId, "OUT-FULL");
    const sources = await prisma().refundSource.findMany();
    expect(sources.reduce((sum, x) => sum + x.amountVnd, 0)).toBe(PRICE + 50_000);
  });
});

describe("đồng thời", () => {
  it("xác nhận hoàn song song với ghép một dòng mới vào cùng đơn → không lỗi, đơn refunded", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    const support = await adminCtx("support");
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "x" });
    if (!("refundId" in r)) throw new Error();
    await advanceRefund(owner, r.refundId, { action: "approve" });
    await advanceRefund(owner, r.refundId, { action: "send", outBankRef: "OUT-C", evidence: "x" });
    expect(await ingest(report({ content: "chuyen bu", amountVnd: PRICE }))).toBe("queued");
    const extra = (await prisma().bankTransaction.findFirstOrThrow({ where: { content: "chuyen bu" } })).id;
    const [confirm, match] = await Promise.all([
      advanceRefund(owner, r.refundId, { action: "confirm" }),
      matchTransfers(support, { orderCode: s.code, bankTransactionIds: [extra], note: "x", evidence: "y" }),
    ]);
    expect(confirm).toBe("ok");
    expect(match).toMatchObject({ result: "rejected" });
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("refunded");
  });
});

describe("route hoàn tiền", () => {
  it("support đề nghị qua route; owner chuyển bước; danh sách có mã đơn", async () => {
    const { GET, POST } = await import("@/app/api/quan-tri/refunds/route");
    const { POST: step } = await import("@/app/api/quan-tri/refunds/[id]/route");
    const { adminSess, callAdmin } = await import("../helpers/admin-call");
    const s = await paid();
    const support = await adminSess("support");
    const owner = await adminSess("owner");
    const created = await callAdmin(POST, support, "POST", "/api/quan-tri/refunds", { orderCode: s.code, reason: "khách yêu cầu" });
    expect(created.status).toBe(201);
    const { refundId } = (await created.json()) as { refundId: string };
    const call = (body: unknown, who = owner) => callAdmin(step, who, "POST", `/api/quan-tri/refunds/${refundId}`, body, { id: refundId });
    expect((await call({ action: "approve" }, support)).status).toBe(403);
    expect((await call({ action: "confirm" })).status).toBe(409);
    expect((await call({ action: "send", outBankRef: "OUT-R" })).status).toBe(400);
    expect((await call({ action: "approve" })).status).toBe(200);
    const list = (await (await callAdmin(GET, support, "GET", "/api/quan-tri/refunds")).json()) as { refunds: { order: { code: string }; status: string }[] };
    expect(list.refunds[0]).toMatchObject({ order: { code: s.code }, status: "approved" });
  });
});
