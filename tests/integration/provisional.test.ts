import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTest } from "@/lib/env";
import { prisma } from "@/lib/db";
import { POST as claimRoute } from "@/app/api/me/orders/[code]/claim/route";
import { POST as proofRoute } from "@/app/api/me/orders/[code]/proof/route";
import { listOrders } from "@/modules/admin/orders";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { entitledCourses } from "@/modules/learn/entitlements";
import { courseManifest, type Manifest } from "@/modules/learn/manifest";
import { approveTransfer, listProofs, proofFile, rejectClaim } from "@/modules/orders/claims";
import { createOrder, getCheckoutForLearner, paymentHistory } from "@/modules/orders/orders";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { paidCourseSetup, PRICE } from "../helpers/ledger";
import { publish } from "../helpers/content";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

// Chủ chọn 03/11/2026: khách bấm "Tôi đã chuyển khoản" là học được ngay (mở tạm, không giới hạn thời gian);
// chủ "Duyệt" (tự xác nhận một bước) hoặc "Không thấy tiền" (khóa lại) khi đối soát.

const claim = (l: TestLearner, code: string) =>
  claimRoute(learnerRequest(`/api/me/orders/${code}/claim`, l, { method: "POST", body: {} }), { params: Promise.resolve({ code }) });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("anh-thu")]);
function sendProof(l: TestLearner, code: string, bytes: Buffer, message = "Em đã chuyển lúc 9h") {
  const form = new FormData();
  form.set("image", new Blob([new Uint8Array(bytes)]), "anh.png");
  form.set("message", message);
  return proofRoute(new Request(`${process.env.APP_ORIGIN}/api/me/orders/${code}/proof`, {
    method: "POST", body: form,
    headers: { cookie: `__Host-me_learn=${l.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": l.csrf },
  }), { params: Promise.resolve({ code }) });
}
async function rejected400(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (error) {
    const e = error as { status?: number; message?: string };
    if (e.status === 400) return e.message ?? "400";
    throw error;
  }
}
const courseOf = async (orderId: string) => (await prisma().orderItem.findFirstOrThrow({ where: { orderId } })).courseId;
const provisional = (orderId: string) => prisma().enrollment.findMany({ where: { claimOrderId: orderId } });

// Mở tạm chỉ dùng khi chưa có SePay (webhook tắt).
beforeEach(() => {
  vi.stubEnv("SEPAY_WEBHOOK_SECRETS", "");
  resetEnvForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTest();
});

describe("khách báo đã chuyển khoản", () => {
  it("SePay đã bật (tiền về tự mở khóa) → không cho báo tay, trang không hiện nút", async () => {
    vi.unstubAllEnvs();
    resetEnvForTest();
    const { learner, code, orderId } = await paidCourseSetup();
    const res = await claim(learner, code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "auto_confirm" });
    expect(await provisional(orderId)).toHaveLength(0);
    expect((await getCheckoutForLearner(learner, code))?.claimable).toBe(false);
  });

  it("đơn đang chờ → mở tạm ngay, có quyền học, báo Telegram cho chủ; đơn vẫn chưa thanh toán", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    const res = await claim(learner, code);
    expect(res.status).toBe(200);
    const [row] = await provisional(orderId);
    expect(row).toMatchObject({ source: "provisional", userId: learner.userId, orderId: null, revokedAt: null });
    expect(await hasCourseAccess(learner.userId, await courseOf(orderId))).toBe(true);
    expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("pending");
    const events = await prisma().outboxEvent.findMany({ where: { kind: "transfer_claimed" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ orderCode: code, amountVnd: PRICE });
    const view = await getCheckoutForLearner(learner, code);
    expect(view).toMatchObject({ enrolled: true, claim: { status: "open" } });
  });

  it("khóa mở tạm được đánh dấu để giấy phép offline chỉ 3 ngày; duyệt xong thì hết đánh dấu", async () => {
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    expect((await entitledCourses(learner.userId)).map((c) => c.provisional)).toEqual([true]);
    const slug = (await entitledCourses(learner.userId))[0]!.slug;
    const manifest = async () => (await courseManifest({ ...learner, ip: "10.0.0.1" } as never, slug)) as Manifest;
    // Chưa xác nhận tiền: app không hiện nút tải về máy.
    expect((await manifest()).provisional).toBe(true);
    const owner = await adminCtx("owner");
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "", note: "", bankTime: new Date() })).toEqual({ result: "paid" });
    expect((await entitledCourses(learner.userId)).map((c) => c.provisional)).toEqual([false]);
    expect((await manifest()).provisional).toBe(false);
  });

  it("đơn đã hết hạn trong 24 giờ, chưa báo: Lịch sử thanh toán vẫn đưa khách tới trang báo đã chuyển; báo rồi thì thôi", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    expect((await paymentHistory(learner))[0]).toMatchObject({ code, claimable: true });
    await sqlAsMigrator(`UPDATE orders SET status = 'expired', expired_at = now() WHERE id = $1`, [orderId]);
    expect((await paymentHistory(learner))[0]).toMatchObject({ code, status: "expired", claimable: true });
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = now() - interval '25 hours', expires_at = now() - interval '1485 minutes' WHERE id = $1`, [orderId]);
    expect((await paymentHistory(learner))[0]).toMatchObject({ code, claimable: false });
    await sqlAsMigrator(`UPDATE orders SET created_at = now() - interval '2 hours', expires_at = now() - interval '105 minutes' WHERE id = $1`, [orderId]);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    await claim(learner, code);
    expect((await paymentHistory(learner))[0]).toMatchObject({ code, claim: "open", claimable: false });
  });

  it("bấm lại → không tạo thêm, không báo lại", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    expect((await claim(learner, code)).status).toBe(200);
    expect((await claim(learner, code)).status).toBe(200);
    expect(await provisional(orderId)).toHaveLength(1);
    expect(await prisma().outboxEvent.count({ where: { kind: "transfer_claimed" } })).toBe(1);
  });

  it("đơn của người khác → 404, không mở gì", async () => {
    const { code, orderId } = await paidCourseSetup();
    const other = await testLearner("Khác");
    expect((await claim(other, code)).status).toBe(404);
    expect(await provisional(orderId)).toHaveLength(0);
  });

  it("đơn đã hết hạn nhưng tạo chưa quá 24 giờ → vẫn báo được; quá 24 giờ → 409", async () => {
    const { learner, code, orderId } = await paidCourseSetup();
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET status = 'expired', expired_at = now(), created_at = now() - interval '2 hours', expires_at = now() - interval '105 minutes' WHERE id = $1`, [orderId]);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await getCheckoutForLearner(learner, code))?.claim.status).toBe("none");
    expect((await getCheckoutForLearner(learner, code))?.claimable).toBe(true);
    expect((await claim(learner, code)).status).toBe(200);

    const late = await paidCourseSetup();
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET status = 'expired', expired_at = now(), created_at = now() - interval '25 hours', expires_at = now() - interval '1485 minutes' WHERE id = $1`, [late.orderId]);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await getCheckoutForLearner(late.learner, late.code))?.claimable).toBe(false);
    const res = await claim(late.learner, late.code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "too_late" });
  });

  it("mỗi tài khoản chỉ một đơn mở tạm chưa duyệt: đơn thứ hai → 409", async () => {
    const { learner, code } = await paidCourseSetup();
    await publish("engine_cadet_dry_cargo", PRICE);
    expect((await claim(learner, code)).status).toBe(200);
    const second = await createOrder(learner, "engine_cadet_dry_cargo");
    if (second.kind !== "created") throw new Error(second.kind);
    const res = await claim(learner, second.order.code);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "claim_limit" });
  });
});

describe("chủ đối soát", () => {
  it("Duyệt: ghi khoản tiền vào sổ (chủ xác nhận), đơn thành đã thanh toán, quyền tạm thay bằng quyền theo đơn, có nhật ký", async () => {
    const owner = await adminCtx("owner");
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "  ft123abc ", note: "Thấy trong app BIDV", bankTime: new Date() })).toEqual({ result: "paid" });

    const order = await prisma().order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("paid");
    const bt = await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: "FT123ABC" } });
    expect(bt).toMatchObject({ source: "manual", enteredBy: owner.adminId, amountVnd: PRICE, content: code });
    expect(await prisma().bankTransactionVerification.findFirst({ where: { bankTransactionId: bt.id } })).toMatchObject({ method: "owner_direct", verifiedBy: owner.adminId });
    expect(await prisma().paymentAllocation.findFirst({ where: { orderId } })).toMatchObject({ kind: "manual", allocatedBy: owner.adminId, amountVnd: PRICE });
    const [temp] = await provisional(orderId);
    expect(temp!.revokedReason).toBe("paid");
    expect(await prisma().enrollment.count({ where: { orderId, source: "order", revokedAt: null } })).toBe(1);
    expect(await hasCourseAccess(learner.userId, await courseOf(orderId))).toBe(true);
    expect(await prisma().adminAuditLog.count({ where: { action: "transfer_approve", adminUserId: owner.adminId } })).toBe(1);
    // Hết giới hạn một đơn mở tạm: đơn đã duyệt không còn tính.
    expect((await getCheckoutForLearner(learner, code))?.claim).toMatchObject({ status: "approved" });
  });

  it("Duyệt không cần mã giao dịch và được cả đơn khách chưa bấm báo; duyệt lại → bị từ chối", async () => {
    const owner = await adminCtx("owner");
    const { code, orderId } = await paidCourseSetup();
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "", note: "", bankTime: new Date() })).toEqual({ result: "paid" });
    expect(await prisma().bankTransaction.count({ where: { bankRef: `DUYET-${code}` } })).toBe(1);
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "", note: "", bankTime: new Date() })).toEqual({ result: "rejected", reason: "order_paid" });
    expect(await prisma().paymentAllocation.count({ where: { orderId } })).toBe(1);
  });

  it("giờ chuyển khoản lấy theo sao kê chủ nhập; giờ trước lúc tạo đơn hay ở tương lai → 400", async () => {
    const owner = await adminCtx("owner");
    const { code, createdAt } = await paidCourseSetup();
    const future = new Date(Date.now() + 3_600_000);
    expect(await rejected400(approveTransfer(owner, { orderCode: code, bankRef: "", note: "", bankTime: future }))).toBe("bank_time");
    expect(await rejected400(approveTransfer(owner, { orderCode: code, bankRef: "", note: "", bankTime: new Date(createdAt.getTime() - 3_600_000) }))).toBe("bank_time");
    const bankTime = new Date(createdAt.getTime() + 60_000);
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "FTGIO", note: "", bankTime })).toEqual({ result: "paid" });
    expect((await prisma().bankTransaction.findFirstOrThrow({ where: { bankRef: "FTGIO" } })).bankTime).toEqual(bankTime);
  });

  it("mã giao dịch đã dùng cho đơn khác → từ chối, đơn này giữ nguyên", async () => {
    const owner = await adminCtx("owner");
    const a = await paidCourseSetup();
    await approveTransfer(owner, { orderCode: a.code, bankRef: "FT999", note: "", bankTime: new Date() });
    const b = await paidCourseSetup();
    expect(await approveTransfer(owner, { orderCode: b.code, bankRef: "ft999", note: "", bankTime: new Date() })).toEqual({ result: "rejected", reason: "ref_used" });
    expect((await prisma().order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe("pending");
  });

  it("Không thấy tiền: khóa lại quyền tạm, có nhật ký; khách không bấm báo lại được đơn đó", async () => {
    const owner = await adminCtx("owner");
    const { learner, code, orderId } = await paidCourseSetup();
    await claim(learner, code);
    expect(await rejectClaim(owner, { orderCode: code, reason: "Sao kê không có" })).toBe("revoked");
    expect(await hasCourseAccess(learner.userId, await courseOf(orderId))).toBe(false);
    expect(await prisma().adminAuditLog.count({ where: { action: "transfer_claim_reject" } })).toBe(1);
    // Email báo khách: lý do và link về trang thanh toán của đơn (gửi ảnh chứng minh ở đó).
    const mail = await prisma().outboxEvent.findFirstOrThrow({ where: { kind: "transfer_claim_rejected", channel: "email" } });
    expect(mail.payload).toMatchObject({ orderCode: code, userId: learner.userId, reason: "Sao kê không có", payUrl: `${process.env.APP_ORIGIN}/thanh-toan/${code}` });
    const again = await claim(learner, code);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "claim_rejected" });
    expect((await getCheckoutForLearner(learner, code))?.claim).toMatchObject({ status: "rejected" });
    // Khóa lại rồi vẫn duyệt được nếu sau đó thấy tiền.
    expect(await approveTransfer(owner, { orderCode: code, bankRef: "", note: "Tiền về muộn", bankTime: new Date() })).toEqual({ result: "paid" });
    expect(await hasCourseAccess(learner.userId, await courseOf(orderId))).toBe(true);
  });

  it("người trực (support) không Duyệt, không khóa lại được", async () => {
    const support = await adminCtx("support");
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    expect(await rejected(approveTransfer(support, { orderCode: code, bankRef: "", note: "", bankTime: new Date() }))).toBe("role");
    expect(await rejected(rejectClaim(support, { orderCode: code, reason: "x" }))).toBe("role");
  });

  it("danh sách đơn của admin hiện đơn đang mở tạm, lọc được 'chờ đối soát'", async () => {
    const owner = await adminCtx("owner");
    const a = await paidCourseSetup();
    await claim(a.learner, a.code);
    await paidCourseSetup();
    const all = await listOrders(owner, { status: null, q: null, cursor: null, limit: 50 });
    expect(all.orders.find((o) => o.code === a.code)).toMatchObject({ claim: "open" });
    const open = await listOrders(owner, { status: "claimed", q: null, cursor: null, limit: 50 });
    expect(open.orders.map((o) => o.code)).toEqual([a.code]);
  });
});

describe("ràng buộc trong DB", () => {
  it("xác nhận một bước chỉ cho tài khoản chủ", async () => {
    const support = await adminCtx("support");
    const { code } = await paidCourseSetup();
    const { rows } = await sqlAsMigrator(
      `INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source, entered_by, evidence)
       VALUES ('BIDV', '0123456789', 'X1', $1, $2, now(), 'manual', $3, 'e') RETURNING id`, [PRICE, code, support.adminId]);
    await expect(sqlAsMigrator(
      `INSERT INTO bank_transaction_verifications (bank_transaction_id, method, verified_by, evidence) VALUES ($1, 'owner_direct', $2, 'e')`,
      [rows[0].id, support.adminId])).rejects.toThrow(/owner_direct_requires_owner/);
  });

  it("quyền mở tạm phải gắn với đơn và không có order_id", async () => {
    const { learner, orderId } = await paidCourseSetup();
    const courseId = await courseOf(orderId);
    await expect(sqlAsMigrator(`INSERT INTO enrollments (user_id, course_id, source) VALUES ($1, $2, 'provisional')`, [learner.userId, courseId])).rejects.toThrow();
    await expect(sqlAsMigrator(`INSERT INTO enrollments (user_id, course_id, source, order_id, claim_order_id) VALUES ($1, $2, 'provisional', $3, $3)`, [learner.userId, courseId, orderId])).rejects.toThrow();
  });
});

describe("ảnh chứng minh khi bị khóa lại", () => {
  it("khách thấy lý do, gửi ảnh; chủ thấy đơn trong 'chờ đối soát', xem được ảnh; báo Telegram", async () => {
    const owner = await adminCtx("owner");
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    await rejectClaim(owner, { orderCode: code, reason: "Sao kê chưa có khoản 199.000đ" });
    expect((await getCheckoutForLearner(learner, code))?.claim).toEqual({ status: "rejected", rejectionReason: "Sao kê chưa có khoản 199.000đ", proofs: 0 });
    expect((await paymentHistory(learner))[0]).toMatchObject({ code, claim: "rejected", rejectionReason: "Sao kê chưa có khoản 199.000đ" });
    expect((await listOrders(owner, { status: "claimed", q: null, cursor: null, limit: 50 })).orders).toHaveLength(0);

    const res = await sendProof(learner, code, PNG);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "rejected", proofs: 1 });
    expect((await listOrders(owner, { status: "claimed", q: null, cursor: null, limit: 50 })).orders.map((o) => o.code)).toEqual([code]);
    const listed = await listProofs(owner, code);
    expect(listed?.proofs).toMatchObject([{ message: "Em đã chuyển lúc 9h" }]);
    expect(await proofFile(owner, listed!.proofs[0]!.id)).toMatchObject({ mime: "image/png" });
    expect(await prisma().outboxEvent.count({ where: { kind: "transfer_proof" } })).toBe(1);
  });

  it("ảnh mới vẫn không khớp: chủ bác lại lần nữa với lý do mới → ra khỏi 'chờ đối soát', khách thấy lý do mới", async () => {
    const owner = await adminCtx("owner");
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    expect(await rejectClaim(owner, { orderCode: code, reason: "Chưa thấy tiền" })).toBe("revoked");
    expect(await rejectClaim(owner, { orderCode: code, reason: "Lặp lại khi chưa có ảnh mới" })).toBe("not_claimed");
    await sendProof(learner, code, PNG);
    expect(await rejectClaim(owner, { orderCode: code, reason: "Ảnh là giao dịch của ngân hàng khác, số tiền 99.000đ" })).toBe("revoked");
    expect((await listOrders(owner, { status: "claimed", q: null, cursor: null, limit: 50 })).orders).toHaveLength(0);
    expect((await getCheckoutForLearner(learner, code))?.claim.rejectionReason).toBe("Ảnh là giao dịch của ngân hàng khác, số tiền 99.000đ");
    expect(await prisma().adminAuditLog.count({ where: { action: "transfer_claim_reject" } })).toBe(2);
  });

  it("không phải ảnh → 400; đơn chưa báo chuyển → 409; đơn người khác → 404", async () => {
    const { learner, code } = await paidCourseSetup();
    expect((await sendProof(learner, code, PNG)).status).toBe(409);
    await claim(learner, code);
    expect((await sendProof(learner, code, Buffer.from("%PDF-1.4 không phải ảnh"))).status).toBe(400);
    expect((await sendProof(await testLearner("Khác"), code, PNG)).status).toBe(404);
  });

  it("tối đa 5 ảnh mỗi đơn", async () => {
    const { learner, code } = await paidCourseSetup();
    await claim(learner, code);
    for (let i = 0; i < 5; i++) expect((await sendProof(learner, code, Buffer.concat([PNG, Buffer.from([i])]))).status).toBe(200);
    expect((await sendProof(learner, code, PNG)).status).toBe(409);
  });
});
