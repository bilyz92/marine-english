import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingest } from "@/modules/ledger/ingest";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { expireOrders } from "@/modules/orders/orders";
import { counts, paidCourseSetup, PRICE, report } from "../helpers/ledger";
import { ageOrders } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";

const inWindow = (createdAt: Date) => new Date(createdAt.getTime() + 60_000);

async function ownerId() {
  const { rows } = await sqlAsMigrator(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at) VALUES ($1,'owner','active',now(),now()+interval '7 days') RETURNING id`,
    [`o${Math.random()}@x.vn`],
  );
  return rows[0].id as string;
}

describe("ingest: tự xác nhận", () => {
  it("giao dịch SePay đúng → confirmed: đơn paid, 1 phân bổ, quyền học, outbox telegram + email", async () => {
    const s = await paidCourseSetup();
    const r = report({ content: `Thanh toan ${s.code}`, bankTime: inWindow(s.createdAt) });
    expect(await ingest(r)).toBe("confirmed");
    const order = await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(order.status).toBe("paid");
    const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_tanker" } });
    expect(await hasCourseAccess(s.learner.userId, course.id)).toBe(true);
    const outbox = await prisma().outboxEvent.findMany({ orderBy: { channel: "asc" } });
    expect(outbox.map((e) => [e.kind, e.channel])).toEqual([["order_paid", "email"], ["order_paid", "telegram"]]);
    expect(await prisma().bankTransactionVerification.count()).toBe(1);
    const paid = await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(outbox[0]!.payload).toMatchObject({
      orderCode: s.code, courses: [course.titleVi], paidAt: paid.paidAt!.toISOString(), learnUrl: new URL("/hoc", process.env.APP_ORIGIN).toString(),
    });
  });

  it("gửi lại y nguyên 3 lần → already_settled, không trùng phân bổ/quyền học/outbox", async () => {
    const s = await paidCourseSetup();
    const r = report({ content: s.code, bankTime: inWindow(s.createdAt) });
    expect(await ingest(r)).toBe("confirmed");
    const before = await counts();
    for (let i = 0; i < 3; i++) expect(await ingest(r)).toBe("already_settled");
    const after = await counts();
    expect({ ...after, observations: 0 }).toEqual({ ...before, observations: 0 });
    expect(after.observations).toBe(before.observations + 3);
  });

  it("cùng provider_event_id gửi lại → duplicate_event", async () => {
    const s = await paidCourseSetup();
    const r = report({ content: s.code, bankTime: inWindow(s.createdAt), providerEventId: "sepay-1" });
    expect(await ingest(r)).toBe("confirmed");
    expect(await ingest(r)).toBe("duplicate_event");
  });

  it("5 lời gọi song song cùng giao dịch → 1 dòng sổ, 1 phân bổ", async () => {
    const s = await paidCourseSetup();
    const r = report({ content: s.code, bankTime: inWindow(s.createdAt) });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => ingest(r)));
    expect(results.filter((x) => x === "confirmed")).toHaveLength(1);
    expect(await counts()).toMatchObject({ ledger: 1, allocations: 1, enrollments: 1 });
  });

  it("đơn đã bị job đặt expired, bankTime trong hạn → vẫn confirmed", async () => {
    const s = await paidCourseSetup();
    await ageOrders(16 * 60_000);
    expect(await expireOrders()).toBe(1);
    const order = await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(await ingest(report({ content: s.code, bankTime: inWindow(order.createdAt) }))).toBe("confirmed");
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
  });

  it("bankTime sau hạn → queued late, đơn giữ expired, outbox ledger_queued", async () => {
    const s = await paidCourseSetup();
    await ageOrders(16 * 60_000);
    await expireOrders();
    const order = await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } });
    expect(await ingest(report({ content: s.code, bankTime: new Date(order.expiresAt.getTime() + 1000) }))).toBe("queued");
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("expired");
    const [c] = await prisma().bankTransactionClassification.findMany();
    expect(c).toMatchObject({ result: "queue", reason: "late", candidateOrderId: s.orderId, candidateCodes: [s.code] });
    expect((await prisma().outboxEvent.findMany()).map((e) => e.kind)).toEqual(["ledger_queued"]);
  });

  it("hai giao dịch đúng tiền song song cho một đơn → một confirmed, một queued order_paid", async () => {
    const s = await paidCourseSetup();
    const results = await Promise.all([
      ingest(report({ content: s.code, bankTime: inWindow(s.createdAt) })),
      ingest(report({ content: s.code, bankTime: inWindow(s.createdAt) })),
    ]);
    expect(results.sort()).toEqual(["confirmed", "queued"]);
    const reasons = (await prisma().bankTransactionClassification.findMany()).map((c) => c.reason);
    expect(reasons).toContain("order_paid");
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
  });
});

describe("ingest: bỏ qua, thiếu dữ kiện, nhập tay, lệch", () => {
  it("tiền ra / ngoại tệ / tài khoản khác → ignored, không dòng sổ", async () => {
    await paidCourseSetup();
    expect(await ingest(report({ direction: "out" }))).toBe("ignored");
    expect(await ingest(report({ currency: "USD" }))).toBe("ignored");
    expect(await ingest(report({ accountNo: "999999999" }))).toBe("ignored");
    expect(await counts()).toMatchObject({ ledger: 0, observations: 3 });
  });

  it("thiếu mã tham chiếu hoặc thời điểm → unresolved", async () => {
    await paidCourseSetup();
    expect(await ingest(report({ bankRef: "  " }))).toBe("unresolved");
    expect(await ingest(report({ bankTime: null }))).toBe("unresolved");
    const obs = await prisma().bankTransactionObservation.findMany({ orderBy: { receivedAt: "asc" } });
    expect(obs.map((o) => o.unresolvedReason).sort()).toEqual(["missing_ref", "missing_time"]);
  });

  it("nhập tay → unverified (không phân loại); SePay báo sau khớp → provider_match rồi confirmed", async () => {
    const s = await paidCourseSetup();
    const owner = await ownerId();
    const manual = report({ source: "manual", enteredBy: owner, evidence: "ảnh sao kê", content: s.code, bankTime: inWindow(s.createdAt), bankRef: "ft777 " });
    expect(await ingest(manual)).toBe("unverified");
    expect(await prisma().bankTransactionClassification.count()).toBe(0);
    expect(await ingest({ ...manual, source: "sepay_webhook", enteredBy: undefined, evidence: undefined, bankRef: "FT777" })).toBe("confirmed");
    expect((await prisma().bankTransactionVerification.findMany()).map((v) => v.method)).toEqual(["provider_match"]);
    expect(await prisma().bankTransaction.count()).toBe(1);
  });

  it("SePay báo cùng định danh nhưng lệch số tiền → mismatch, không xác minh, cảnh báo", async () => {
    const s = await paidCourseSetup();
    const owner = await ownerId();
    const manual = report({ source: "manual", enteredBy: owner, evidence: "x", content: s.code, bankTime: inWindow(s.createdAt), bankRef: "FT888" });
    await ingest(manual);
    expect(await ingest({ ...manual, source: "sepay_webhook", enteredBy: undefined, evidence: undefined, amountVnd: PRICE + 1 })).toBe("mismatch");
    expect(await prisma().bankTransactionVerification.count()).toBe(0);
    expect((await prisma().outboxEvent.findMany()).map((e) => e.kind)).toEqual(["ledger_mismatch"]);
    expect((await prisma().bankTransactionObservation.findMany({ where: { mismatch: true } }))).toHaveLength(1);
  });
});
