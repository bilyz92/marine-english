import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingest } from "@/modules/ledger/ingest";
import { matchTransfers, setDisposition } from "@/modules/ledger/match";
import { listQueue } from "@/modules/ledger/queue";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { paidCourseSetup, PRICE, report } from "../helpers/ledger";

/** Giao dịch SePay đã xác minh nhưng nằm trong hàng chờ (không mã); trả id dòng sổ. */
async function queuedTx(amountVnd: number, bankTime = new Date(), content = "chuyen tien hoc phi") {
  const r = report({ amountVnd, content, bankTime });
  expect(await ingest(r)).toBe("queued");
  return (await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: r.bankRef! } })).id;
}

const evidence = { note: "khách gửi ảnh chuyển khoản", evidence: "ảnh zalo 30/10" };

describe("ghép tay", () => {
  it("support ghép 1 dòng đúng tiền không mã → paid, phân bổ manual có người làm; dùng lại dòng đó → already_settled", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const tx = await queuedTx(PRICE);
    expect(await matchTransfers(support, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "paid" });
    const alloc = await prisma().paymentAllocation.findFirstOrThrow();
    expect(alloc).toMatchObject({ kind: "manual", allocatedBy: support.adminId, orderId: s.orderId });
    expect(await prisma().enrollment.count({ where: { orderId: s.orderId } })).toBe(1);
    expect(await matchTransfers(support, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "rejected", reason: "already_settled" });
    expect((await auditRows("ledger_match")).map((r) => [r.result, r.reason])).toEqual([["ok", evidence.note], ["denied", "already_settled"]]);
    expect(await listQueue()).toEqual([]);
  });

  it("dòng chưa xác minh → not_verified; đơn đã paid → order_paid; mã đơn sai → not_found", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const owner = await adminCtx("owner");
    const { enterStatementLine } = await import("@/modules/ledger/manual");
    await enterStatementLine(support, { bankCode: "VCB", accountNo: "0123456789", bankRef: "ST1", amountVnd: PRICE, bankTime: new Date(), content: "", evidence: "x" });
    const manual = (await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: "ST1" } })).id;
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [manual], ...evidence })).toEqual({ result: "rejected", reason: "not_verified" });
    expect(await matchTransfers(owner, { orderCode: "MEAAAAAAAA", bankTransactionIds: [await queuedTx(PRICE)], ...evidence })).toEqual({ result: "rejected", reason: "not_found" });
    const tx = await queuedTx(PRICE);
    await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence });
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [await queuedTx(PRICE)], ...evidence })).toEqual({ result: "rejected", reason: "order_paid" });
  });

  it("support ghép 2 dòng → 403 role + audit denied; owner ghép 2 dòng tổng đủ → paid, 2 phân bổ", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const owner = await adminCtx("owner");
    const a = await queuedTx(100_000);
    const b = await queuedTx(PRICE - 100_000);
    expect(await rejected(matchTransfers(support, { orderCode: s.code, bankTransactionIds: [a, b], ...evidence }))).toBe("role");
    expect((await auditRows("ledger_match")).map((r) => [r.result, r.reason])).toEqual([["denied", "role"]]);
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [a, b], ...evidence })).toEqual({ result: "paid" });
    expect(await prisma().paymentAllocation.count({ where: { orderId: s.orderId } })).toBe(2);
  });

  it("thiếu tiền → short, đơn không đổi; thừa → paid + refund excess từ dòng muộn nhất", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const short = await queuedTx(PRICE - 1);
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [short], ...evidence })).toEqual({ result: "short" });
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("pending");
    const early = await queuedTx(150_000, new Date(Date.now() - 60_000));
    const late = await queuedTx(100_000, new Date());
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [late, early], ...evidence })).toEqual({ result: "paid_with_excess_refund" });
    const refund = await prisma().refund.findFirstOrThrow({ include: { sources: true } });
    expect(refund).toMatchObject({ kind: "excess", amountVnd: 250_000 - PRICE, status: "requested", requestedBy: owner.adminId });
    expect(refund.sources.map((x) => [x.bankTransactionId, x.amountVnd])).toEqual([[late, 250_000 - PRICE]]);
  });

  it("ghép tay cùng lúc webhook xác nhận cùng đơn → một bên thắng, không lỗi", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const tx = await queuedTx(PRICE);
    const [manual, auto] = await Promise.all([
      matchTransfers(support, { orderCode: s.code, bankTransactionIds: [tx], ...evidence }),
      ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) })),
    ]);
    const outcomes = [JSON.stringify(manual), auto];
    expect(outcomes.some((o) => o === JSON.stringify({ result: "paid" }) || o === "confirmed")).toBe(true);
    expect(await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).toMatchObject({ status: "paid" });
    expect(await prisma().enrollment.count()).toBe(1);
  });
});

describe("kết luận", () => {
  it("owner đánh dấu ignored → rời hàng chờ; ghép sau đó → already_settled; support → 403", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const support = await adminCtx("support");
    const tx = await queuedTx(PRICE);
    expect(await rejected(setDisposition(support, tx, { kind: "ignored", reason: "không phải học phí" }))).toBe("role");
    expect(await setDisposition(owner, tx, { kind: "ignored", reason: "không phải học phí" })).toBe("ok");
    expect(await setDisposition(owner, tx, { kind: "duplicate", reason: "khách chuyển hai lần" })).toBe("ok");
    expect(await prisma().bankTransactionDisposition.count({ where: { supersededAt: null } })).toBe(1);
    expect(await listQueue()).toEqual([]);
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "rejected", reason: "already_settled" });
  });
});

describe("route ghép tay, kết luận, cấp quyền", () => {
  it("POST match/disposition/grants qua route", async () => {
    const { POST: match } = await import("@/app/api/quan-tri/ledger/match/route");
    const { POST: disposition } = await import("@/app/api/quan-tri/ledger/[id]/disposition/route");
    const { POST: grant, PATCH: revoke } = await import("@/app/api/quan-tri/grants/route");
    const { adminSess, callAdmin } = await import("../helpers/admin-call");
    const s = await paidCourseSetup();
    const support = await adminSess("support");
    const owner = await adminSess("owner");
    const tx = await queuedTx(PRICE);
    const ok = await callAdmin(match, support, "POST", "/api/quan-tri/ledger/match", { orderCode: s.code, bankTransactionIds: [tx], ...evidence });
    expect([ok.status, await ok.json()]).toEqual([200, { result: "paid" }]);
    const again = await callAdmin(match, support, "POST", "/api/quan-tri/ledger/match", { orderCode: s.code, bankTransactionIds: [tx], ...evidence });
    expect(again.status).toBe(409);
    const other = await queuedTx(PRICE);
    const d = await callAdmin(disposition, owner, "POST", `/api/quan-tri/ledger/${other}/disposition`, { kind: "ignored", reason: "không liên quan" }, { id: other });
    expect([d.status, await d.json()]).toEqual([200, { result: "ok" }]);
    const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_dry_cargo" } });
    const g = await callAdmin(grant, owner, "POST", "/api/quan-tri/grants", { userId: s.learner.userId, courseId: course.id, reason: "tặng" });
    expect(g.status).toBe(201);
    const { enrollmentId } = (await g.json()) as { enrollmentId: string };
    expect((await callAdmin(revoke, owner, "PATCH", "/api/quan-tri/grants", { enrollmentId, reason: "hết hạn tặng" })).status).toBe(200);
    expect((await callAdmin(grant, support, "POST", "/api/quan-tri/grants", { userId: s.learner.userId, courseId: course.id, reason: "x" })).status).toBe(403);
  });
});

describe("mở lại kết luận (review P2 I-3)", () => {
  it("owner mở lại giao dịch đã bỏ qua → về hàng chờ, ghép được; support → 403; không có kết luận → not_found", async () => {
    const { reopenTransfer } = await import("@/modules/ledger/match");
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE);
    await setDisposition(owner, tx, { kind: "ignored", reason: "chờ liên hệ" });
    expect(await rejected(reopenTransfer(await adminCtx("support"), tx, "khách gọi lại"))).toBe("role");
    expect(await reopenTransfer(owner, tx, "khách gọi lại")).toBe("ok");
    expect(await reopenTransfer(owner, tx, "lần hai")).toBe("not_found");
    expect((await listQueue()).map((q) => q.bankTransactionId)).toEqual([tx]);
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "paid" });
    expect((await auditRows("ledger_reopen")).map((r) => [r.result, r.reason])).toEqual([["denied", "role"], ["ok", "khách gọi lại"], ["denied", "not_found"]]);
  });
});


describe("nhật ký thao tác bị từ chối (Codex #9)", () => {
  it("ghép bị từ chối theo trạng thái → audit denied có lý do", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const tx = await queuedTx(PRICE);
    await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence });
    expect(await matchTransfers(owner, { orderCode: s.code, bankTransactionIds: [tx], ...evidence })).toEqual({ result: "rejected", reason: "already_settled" });
    expect((await auditRows("ledger_match")).map((r) => [r.result, r.reason])).toEqual([["ok", "khách gửi ảnh chuyển khoản"], ["denied", "already_settled"]]);
  });
});
