import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as listMine, POST as postOrder } from "@/app/api/me/orders/route";
import { GET as getOrder } from "@/app/api/me/orders/[code]/route";
import { ingest } from "@/modules/ledger/ingest";
import { setDisposition } from "@/modules/ledger/match";
import { classifyPath } from "@/modules/sessions/routes";
import { adminCtx } from "../helpers/admin-ctx";
import { PRICE, report, SLUG } from "../helpers/ledger";
import { seedContent, publish } from "../helpers/content";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

const payment = vi.hoisted(() => ({ unavailable: false }));
vi.mock("@/modules/orders/payment-info", async (original) => {
  const actual = await original<typeof import("@/modules/orders/payment-info")>();
  return { ...actual, paymentInfo: () => (payment.unavailable ? null : actual.paymentInfo()) };
});
afterEach(() => {
  payment.unavailable = false;
});

async function setup() {
  await seedContent();
  await publish(SLUG, PRICE);
  return testLearner();
}
const buy = (l: TestLearner, body: object) => postOrder(learnerRequest("/api/me/orders", l, { method: "POST", body }));
const read = async (l: TestLearner, code: string) => {
  const res = await getOrder(learnerRequest(`/api/me/orders/${code}`, l), { params: Promise.resolve({ code }) });
  if (res.status === 200) expect(res.headers.get("cache-control")).toContain("no-store");
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
async function bought(l: TestLearner) {
  const res = await buy(l, { courseSlug: SLUG, acceptTerms: true });
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}
const acceptances = () => prisma().orderTermsAcceptance.findMany();
const orderOf = (code: string) => prisma().order.findUniqueOrThrow({ where: { code } });

describe("mua khóa", () => {
  it("chưa đồng ý điều khoản → 400, không có đơn", async () => {
    const l = await setup();
    expect((await buy(l, { courseSlug: SLUG })).status).toBe(400);
    expect((await buy(l, { courseSlug: SLUG, acceptTerms: false })).status).toBe(400);
    expect(await prisma().order.count()).toBe(0);
  });

  it("đồng ý → có đơn, ghi đúng phiên bản điều khoản; giá lấy từ máy chủ dù client gửi số khác", async () => {
    const l = await setup();
    const res = await buy(l, { courseSlug: SLUG, acceptTerms: true, amount: 1 });
    expect(res.status).toBe(201);
    const { code, amountDueVnd } = (await res.json()) as { code: string; amountDueVnd: number };
    expect(amountDueVnd).toBe(PRICE);
    const [row] = await acceptances();
    expect(row).toMatchObject({ orderId: (await orderOf(code)).id, userId: l.userId, termsVersion: "thu-nghiem-1" });
  });

  it("mua lại khi đơn còn chờ → trả đơn cũ, không tạo đơn thứ hai, không ghi đè lần đồng ý đầu", async () => {
    const l = await setup();
    const code = await bought(l);
    const [first] = await acceptances();
    const again = await buy(l, { courseSlug: SLUG, acceptTerms: true });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { code: string }).code).toBe(code);
    expect(await prisma().order.count()).toBe(1);
    expect(await acceptances()).toEqual([first]);
  });

  it("đơn cũ chưa có đồng ý: mua lại thì ghi đồng ý trong cùng thao tác", async () => {
    const l = await setup();
    const code = await bought(l);
    await sqlAsMigrator(`ALTER TABLE order_terms_acceptances DISABLE TRIGGER USER`);
    await sqlAsMigrator(`DELETE FROM order_terms_acceptances`);
    await sqlAsMigrator(`ALTER TABLE order_terms_acceptances ENABLE TRIGGER USER`);
    expect((await buy(l, { courseSlug: SLUG, acceptTerms: true })).status).toBe(200);
    expect((await acceptances())[0]).toMatchObject({ orderId: (await orderOf(code)).id });
  });

  it("nhật ký đồng ý bất biến", async () => {
    const l = await setup();
    await bought(l);
    await expect(sqlAsMigrator(`UPDATE order_terms_acceptances SET terms_version = 'x'`)).rejects.toThrow();
    await expect(sqlAsMigrator(`DELETE FROM order_terms_acceptances`)).rejects.toThrow();
  });

  it("thiếu cấu hình thanh toán → 503, không có đơn", async () => {
    const l = await setup();
    payment.unavailable = true;
    const res = await buy(l, { courseSlug: SLUG, acceptTerms: true });
    expect(res.status).toBe(503);
    expect(await prisma().order.count()).toBe(0);
    expect(await acceptances()).toEqual([]);
  });
});

describe("trạng thái đơn", () => {
  it("đơn đang chờ có thông tin chuyển khoản lấy từ cấu hình, giờ máy chủ", async () => {
    const l = await setup();
    const code = await bought(l);
    const { body } = await read(l, code);
    expect(body).toMatchObject({
      status: "pending", amountDueVnd: PRICE, enrolled: false, needsManual: false, paymentUnavailable: false,
      payment: { bankName: "Ngan hang thu", accountNo: "0123456789", accountName: "TEN THU NGHIEM", qrImageUrl: "/media/qr-thu.png" },
    });
    expect(typeof body.serverNow).toBe("string");
  });

  it("quá hạn hoặc đã hết hạn → không còn thông tin chuyển khoản", async () => {
    const l = await setup();
    const code = await bought(l);
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = created_at - interval '20 minutes', expires_at = expires_at - interval '20 minutes'`);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await read(l, code)).body.payment).toBeNull();
  });

  it("đơn còn hạn nhưng cấu hình nhận tiền vừa bị gỡ → paymentUnavailable, không báo hết hạn", async () => {
    const l = await setup();
    const code = await bought(l);
    payment.unavailable = true;
    expect((await read(l, code)).body).toMatchObject({ status: "pending", payment: null, paymentUnavailable: true });
  });

  it("đơn người khác → 404", async () => {
    const l = await setup();
    const code = await bought(l);
    expect((await read(await testLearner("Khac"), code)).status).toBe(404);
  });

  it("tiền về đúng → paid, enrolled, không còn thông tin chuyển khoản", async () => {
    const l = await setup();
    const code = await bought(l);
    const order = await orderOf(code);
    expect(await ingest(report({ content: code, bankTime: new Date(order.createdAt.getTime() + 60_000) }))).toBe("confirmed");
    expect((await read(l, code)).body).toMatchObject({ status: "paid", enrolled: true, payment: null, needsManual: false });
  });

  it("tiền trong hạn nhưng báo muộn: đơn đã expired vẫn thành paid ở lần hỏi kế tiếp", async () => {
    const l = await setup();
    const code = await bought(l);
    const order = await orderOf(code);
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = created_at - interval '20 minutes', expires_at = expires_at - interval '20 minutes', status = 'expired', expired_at = now()`);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await read(l, code)).body.status).toBe("expired");
    const moved = await orderOf(code);
    expect(order.id).toBe(moved.id);
    await ingest(report({ content: code, bankTime: new Date(moved.createdAt.getTime() + 60_000) }));
    expect((await read(l, code)).body).toMatchObject({ status: "paid", enrolled: true });
  });

  it("sai số tiền → needsManual, không lộ nội dung chuyển khoản, hết cờ khi không còn trong hàng chờ", async () => {
    const l = await setup();
    const code = await bought(l);
    const order = await orderOf(code);
    await ingest(report({ content: `${code} NGUYEN VAN A`, amountVnd: PRICE - 1000, bankTime: new Date(order.createdAt.getTime() + 60_000) }));
    const { body } = await read(l, code);
    expect(body).toMatchObject({ status: "pending", needsManual: true });
    expect(JSON.stringify(body)).not.toContain("NGUYEN VAN A");
    const bt = await prisma().bankTransaction.findFirstOrThrow();
    await setDisposition(await adminCtx("owner"), bt.id, { kind: "ignored", reason: "thử" });
    expect((await read(l, code)).body.needsManual).toBe(false);
  });
});

describe("đơn gần đây của khóa", () => {
  const recent = async (l: TestLearner) => {
    const res = await listMine(learnerRequest(`/api/me/orders?course=${SLUG}`, l));
    return (await res.json()) as { enrolled: boolean; unresolved: { code: string; status: string }[] };
  };

  it("đơn vừa hết hạn trong 48 giờ hiện lại để không chuyển tiền lần nữa", async () => {
    const l = await setup();
    const code = await bought(l);
    expect(await recent(l)).toEqual({ enrolled: false, unresolved: [] });
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = created_at - interval '20 minutes', expires_at = expires_at - interval '20 minutes', status = 'expired', expired_at = now()`);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await recent(l)).unresolved).toEqual([expect.objectContaining({ code, status: "expired" })]);
    expect((await recent(await testLearner("Khac"))).unresolved).toEqual([]);
  });

  it("đơn đang chờ đối chiếu tay vẫn hiện dù đã quá 48 giờ", async () => {
    const l = await setup();
    const code = await bought(l);
    const order = await orderOf(code);
    await ingest(report({ content: code, amountVnd: PRICE - 1000, bankTime: new Date(order.createdAt.getTime() + 60_000) }));
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = created_at - interval '5 days', expires_at = expires_at - interval '5 days', status = 'expired', expired_at = now()`);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await recent(l)).unresolved).toEqual([expect.objectContaining({ code })]);
  });

  it("khoản chuyển ghi nhiều mã đơn: đơn vẫn hiện cảnh báo sau 48 giờ, trang thanh toán báo cần đối chiếu", async () => {
    const l = await setup();
    const code = await bought(l);
    const order = await orderOf(code);
    await ingest(report({ content: `${code} MEZZZZZZZZ`, bankTime: new Date(order.createdAt.getTime() + 60_000) }));
    expect((await read(l, code)).body.needsManual).toBe(true);
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET created_at = created_at - interval '5 days', expires_at = expires_at - interval '5 days', status = 'expired', expired_at = now()`);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    expect((await recent(l)).unresolved).toEqual([expect.objectContaining({ code })]);
  });

  it("đã có khóa → enrolled ngay khi mở trang mua", async () => {
    const l = await setup();
    const code = await bought(l);
    await ingest(report({ content: code, bankTime: new Date((await orderOf(code)).createdAt.getTime() + 60_000) }));
    expect(await recent(l)).toEqual({ enrolled: true, unresolved: [] });
  });
});

describe("đường dẫn", () => {
  it("trang mua và thanh toán cần đăng nhập ở lớp proxy", () => {
    expect(classifyPath("/mua/khoa-a")).toBe("learner");
    expect(classifyPath("/thanh-toan/ME7K3QX9AB")).toBe("learner");
    expect(classifyPath("/khoa-hoc/khoa-a")).toBe("public");
  });
});
