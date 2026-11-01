import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as myRefunds, POST as requestMyRefund } from "@/app/api/me/refunds/route";
import { GET as overviewRoute } from "@/app/api/quan-tri/overview/route";
import { ingest } from "@/modules/ledger/ingest";
import { advanceRefund, requestFullRefund, setRefundPayout } from "@/modules/refunds/refunds";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { adminCtx } from "../helpers/admin-ctx";
import { paidCourseSetup, report, TEST_PAYOUT } from "../helpers/ledger";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

async function paid() {
  const s = await paidCourseSetup();
  expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
  return s;
}
const ask = async (l: TestLearner, body: object) => {
  const res = await requestMyRefund(learnerRequest("/api/me/refunds", l, { method: "POST", body }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe("học viên tự yêu cầu hoàn tiền (FR-28, BR-18)", () => {
  it("đơn đã thanh toán của mình → yêu cầu với tài khoản nhận tiền; báo Telegram không kèm số tài khoản", async () => {
    const s = await paid();
    const r = await ask(s.learner, { orderCode: s.code, reason: "không hợp với tôi", payout: TEST_PAYOUT });
    expect(r.status).toBe(201);
    const refund = await prisma().refund.findFirstOrThrow({ where: { orderId: s.orderId } });
    expect(refund).toMatchObject({
      kind: "full", status: "requested", requestedBy: null, requestedByUser: s.learner.userId,
      payoutBankName: "Vietcombank", payoutAccountNo: "0011223344", payoutAccountName: "NGUYEN VAN THU",
    });
    const alert = await prisma().outboxEvent.findFirstOrThrow({ where: { kind: "refund_requested" } });
    expect(alert.channel).toBe("telegram");
    expect(JSON.stringify(alert.payload)).not.toContain("0011223344");
  });

  it("thiếu hoặc sai tài khoản nhận tiền, thiếu lý do → 400", async () => {
    const s = await paid();
    expect((await ask(s.learner, { orderCode: s.code, reason: "x" })).status).toBe(400);
    expect((await ask(s.learner, { orderCode: s.code, reason: "x", payout: { ...TEST_PAYOUT, accountNo: "12ab" } })).status).toBe(400);
    expect((await ask(s.learner, { orderCode: s.code, reason: " ", payout: TEST_PAYOUT })).status).toBe(400);
    expect(await prisma().refund.count()).toBe(0);
  });

  it("đơn người khác → 404; đơn chưa thanh toán → 409; đã có yêu cầu đang mở → 409", async () => {
    const s = await paid();
    const other = await testLearner("Khac");
    expect((await ask(other, { orderCode: s.code, reason: "x", payout: TEST_PAYOUT })).status).toBe(404);
    expect((await ask(s.learner, { orderCode: s.code, reason: "x", payout: TEST_PAYOUT })).status).toBe(201);
    expect(await ask(s.learner, { orderCode: s.code, reason: "x", payout: TEST_PAYOUT })).toMatchObject({ status: 409, body: { error: "active_full_refund" } });
    const unpaid = await testLearner("Chua tra");
    const { createOrder } = await import("@/modules/orders/orders");
    const o = await createOrder(unpaid, "engine_cadet_tanker");
    if (o.kind !== "created") throw new Error(o.kind);
    expect(await ask(unpaid, { orderCode: o.order.code, reason: "x", payout: TEST_PAYOUT })).toMatchObject({ status: 409, body: { error: "not_paid" } });
  });

  it("danh sách đơn của tôi kèm trạng thái yêu cầu hoàn", async () => {
    const s = await paid();
    await ask(s.learner, { orderCode: s.code, reason: "x", payout: TEST_PAYOUT });
    const res = await myRefunds(learnerRequest("/api/me/refunds", s.learner));
    const { orders } = (await res.json()) as { orders: { code: string; status: string; refund: { status: string } | null }[] };
    expect(orders).toEqual([expect.objectContaining({ code: s.code, status: "paid", refund: expect.objectContaining({ status: "requested" }) })]);
  });
});

describe("từ chối yêu cầu hoàn tiền báo học viên (UC-10 bước 3)", () => {
  it("hủy yêu cầu của một đơn → email cho chủ đơn kèm lý do, một lần, không kèm số tài khoản", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    const r = await ask(s.learner, { orderCode: s.code, reason: "không hợp", payout: TEST_PAYOUT });
    const refundId = String(r.body.refundId);
    expect(await advanceRefund(owner, refundId, { action: "cancel", reason: "đã học quá nửa khóa" })).toBe("ok");
    const mail = await prisma().outboxEvent.findMany({ where: { kind: "refund_cancelled" } });
    expect(mail).toHaveLength(1);
    expect(mail[0]!.channel).toBe("email");
    expect(mail[0]!.payload).toMatchObject({ orderCode: s.code, userId: s.learner.userId, reason: "đã học quá nửa khóa" });
    expect(JSON.stringify(mail[0]!.payload)).not.toContain("0011223344");
  });
});

describe("duyệt hoàn tiền cần tài khoản nhận (BR-18)", () => {
  it("chưa có tài khoản → không duyệt được; hỗ trợ nhập tài khoản → chủ duyệt được", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "khách gọi điện" });
    if (!("refundId" in r)) throw new Error(JSON.stringify(r));
    expect(await advanceRefund(owner, r.refundId, { action: "approve" })).toBe("missing_payout");
    expect(await setRefundPayout(await adminCtx("support"), r.refundId, TEST_PAYOUT)).toBe("ok");
    expect(await advanceRefund(owner, r.refundId, { action: "approve" })).toBe("ok");
  });

  it("đã duyệt thì không đổi được tài khoản nhận, kể cả sửa thẳng DB", async () => {
    const s = await paid();
    const owner = await adminCtx("owner");
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "x", payout: TEST_PAYOUT });
    if (!("refundId" in r)) throw new Error();
    await advanceRefund(owner, r.refundId, { action: "approve" });
    expect(await setRefundPayout(owner, r.refundId, { ...TEST_PAYOUT, accountNo: "9999999999" })).toBe("invalid_transition");
    await expect(sqlAsMigrator(`UPDATE refunds SET payout_account_no = '9999' WHERE id = $1`, [r.refundId])).rejects.toThrow();
  });

  it("yêu cầu không tồn tại → not_found", async () => {
    expect(await setRefundPayout(await adminCtx("owner"), crypto.randomUUID(), TEST_PAYOUT)).toBe("not_found");
  });
});

describe("báo cáo doanh thu theo khóa (FR-20)", () => {
  it("tổng quan có số đơn và tiền nhận theo từng khóa trong khoảng", async () => {
    const s = await paid();
    const { data } = await callAdmin(overviewRoute, await adminSess("owner"), "GET", "/api/quan-tri/overview?days=1").then(async (r) => ({ data: (await r.json()) as { byCourse: { course: string; paidOrders: number; receivedVnd: number }[] } }));
    const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_tanker" } });
    expect(data.byCourse).toEqual([{ course: course.titleVi, paidOrders: 1, receivedVnd: (await prisma().order.findUniqueOrThrow({ where: { code: s.code } })).amountDueVnd }]);
  });
});
