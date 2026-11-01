import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as myRefunds, POST as requestMyRefund } from "@/app/api/me/refunds/route";
import { GET as overviewRoute } from "@/app/api/quan-tri/overview/route";
import { GET as refundsRoute } from "@/app/api/quan-tri/refunds/route";
import { ingest } from "@/modules/ledger/ingest";
import { advanceRefund, requestFullRefund, setRefundPayout } from "@/modules/refunds/refunds";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { auditRows } from "../helpers/admin";
import { paidCourseSetup, report, TEST_PAYOUT } from "../helpers/ledger";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { publish } from "../helpers/content";

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

  it("hỗ trợ chỉ thấy 4 số cuối tài khoản nhận; chủ thấy đủ", async () => {
    const s = await paid();
    await ask(s.learner, { orderCode: s.code, reason: "không hợp", payout: TEST_PAYOUT });
    const list = async (role: "owner" | "support") =>
      ((await (await callAdmin(refundsRoute, await adminSess(role), "GET", "/api/quan-tri/refunds")).json()) as { refunds: { payoutAccountNo: string }[] }).refunds;
    expect((await list("owner"))[0]!.payoutAccountNo).toBe("0011223344");
    expect((await list("support"))[0]!.payoutAccountNo).toBe("•••• 3344");
  });

  it("hỗ trợ không sửa được tài khoản học viên tự khai hay tài khoản đã nhập; chủ sửa được khi có lý do, nhật ký che số", async () => {
    const s = await paid();
    const support = await adminCtx("support");
    const owner = await adminCtx("owner");
    const mine = String((await ask(s.learner, { orderCode: s.code, reason: "không hợp", payout: TEST_PAYOUT })).body.refundId);
    const other = { ...TEST_PAYOUT, accountNo: "5566778899" };
    expect(await rejected(setRefundPayout(support, mine, other))).toBe("role");
    await expect(setRefundPayout(owner, mine, other)).rejects.toMatchObject({ status: 400 });
    expect(await setRefundPayout(owner, mine, other, "khách nhắn sai số, gọi lại xác nhận")).toBe("ok");
    expect((await prisma().refund.findUniqueOrThrow({ where: { id: mine } })).payoutAccountNo).toBe("5566778899");
    const [entry] = (await auditRows("refund_payout")).filter((r) => r.result === "ok");
    expect(entry!.reason).toBe("khách nhắn sai số, gọi lại xác nhận");
    const { rows } = await sqlAsMigrator(`SELECT before, after FROM admin_audit_log WHERE action = 'refund_payout' AND result = 'ok'`);
    expect(JSON.stringify(rows)).not.toMatch(/0011223344|5566778899/);
    expect(rows[0]).toMatchObject({ before: { accountNo: "•••• 3344" }, after: { accountNo: "•••• 8899" } });
  });

  it("hỗ trợ nhập lần đầu cho yêu cầu do quản trị tạo được; nhập rồi thì hỗ trợ không sửa nữa", async () => {
    const s = await paid();
    const support = await adminCtx("support");
    const r = await requestFullRefund(await adminCtx("owner"), { orderCode: s.code, reason: "khách gọi điện" });
    if (!("refundId" in r)) throw new Error(JSON.stringify(r));
    expect(await setRefundPayout(support, r.refundId, TEST_PAYOUT)).toBe("ok");
    expect(await rejected(setRefundPayout(support, r.refundId, { ...TEST_PAYOUT, accountNo: "5566778899" }))).toBe("role");
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
    expect(data.byCourse).toEqual([{ courseId: course.id, course: course.titleVi, paidOrders: 1, receivedVnd: (await prisma().order.findUniqueOrThrow({ where: { code: s.code } })).amountDueVnd }]);
  });

  it("hai khóa trùng tên vẫn tách riêng; đơn nhiều khóa chia tiền theo giá từng dòng", async () => {
    const s = await paid();
    await publish("engine_cadet_dry_cargo", 100_000);
    const id = async (slug: string) => (await prisma().course.findUniqueOrThrow({ where: { slug } })).id;
    const tanker = await id("engine_cadet_tanker");
    const dry = await id("engine_cadet_dry_cargo");
    await sqlAsMigrator(`UPDATE courses SET title_vi = (SELECT title_vi FROM courses WHERE id = $1) WHERE id = $2`, [tanker, dry]);
    // Đơn hai khóa (combo chưa có trên giao diện, chờ G14): dựng thẳng bằng SQL trong một transaction.
    await sqlAsMigrator(`
      INSERT INTO orders (code, user_id, status, amount_due_vnd, refund_policy_version, expires_at, created_at, paid_at)
      VALUES ('MEAAAAAAAB', '${s.learner.userId}', 'paid', 200000, 'v1', now() + interval '15 minutes', now(), now());
      INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
      SELECT o.id, v.course_id, v.id, 150000, CASE WHEN v.course_id = '${tanker}' THEN 120000 ELSE 80000 END
      FROM orders o, LATERAL (SELECT DISTINCT ON (course_id) id, course_id FROM course_versions
                              WHERE course_id IN ('${tanker}', '${dry}') ORDER BY course_id, version DESC) v
      WHERE o.code = 'MEAAAAAAAB';`);
    const res = await callAdmin(overviewRoute, await adminSess("owner"), "GET", "/api/quan-tri/overview?days=1");
    const { byCourse } = (await res.json()) as { byCourse: { courseId: string; paidOrders: number; receivedVnd: number }[] };
    const first = (await prisma().order.findUniqueOrThrow({ where: { code: s.code } })).amountDueVnd;
    expect(byCourse.map(({ courseId, paidOrders, receivedVnd }) => ({ courseId, paidOrders, receivedVnd })).sort((a, b) => a.receivedVnd - b.receivedVnd))
      .toEqual([{ courseId: dry, paidOrders: 1, receivedVnd: 80_000 }, { courseId: tanker, paidOrders: 2, receivedVnd: first + 120_000 }]);
  });
});
