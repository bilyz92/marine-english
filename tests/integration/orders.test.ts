import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createOrder, expireOrders, getOrderForLearner, OrderCodeExhaustedError } from "@/modules/orders/orders";
import { POST as postOrder } from "@/app/api/me/orders/route";
import { GET as getOrder } from "@/app/api/me/orders/[code]/route";
import { publish, seedContent } from "../helpers/content";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { ageOrders } from "../helpers/money";

const SLUG = "engine_cadet_tanker";

async function setup(price = 199_000) {
  await seedContent();
  await publish(SLUG, price);
  return testLearner();
}

describe("tạo đơn", () => {
  it("giá lấy từ máy chủ, bỏ qua số tiền client gửi; đơn cũ giữ giá khi khóa đổi giá", async () => {
    const l = await setup();
    const res = await postOrder(learnerRequest("/api/me/orders", l, { method: "POST", body: { courseSlug: SLUG, amountVnd: 1, acceptTerms: true } }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; amountDueVnd: number; status: string; courseSlug: string };
    expect(body).toMatchObject({ amountDueVnd: 199_000, status: "pending", courseSlug: SLUG });
    expect(body.code).toMatch(/^ME[A-Z2-9]{8}$/);
    await publish(SLUG, 299_000);
    const view = await getOrderForLearner(l, body.code);
    expect(view!.amountDueVnd).toBe(199_000);
    const item = await prisma().orderItem.findFirstOrThrow();
    expect([item.listPriceVnd, item.finalPriceVnd]).toEqual([199_000, 199_000]);
  });

  it("khóa chưa mở bán → 409 not_for_sale; khóa không tồn tại → 409", async () => {
    await seedContent();
    const l = await testLearner();
    for (const courseSlug of [SLUG, "khong-co"]) {
      const res = await postOrder(learnerRequest("/api/me/orders", l, { method: "POST", body: { courseSlug, acceptTerms: true } }));
      expect([res.status, await res.json()]).toEqual([409, { error: "not_for_sale" }]);
    }
  });

  it("gọi lại khi còn đơn chờ → trả đơn cũ; song song → một đơn", async () => {
    const l = await setup();
    const a = await createOrder(l, SLUG);
    const b = await createOrder(l, SLUG);
    expect(a.kind).toBe("created");
    expect(b.kind).toBe("existing");
    if (a.kind !== "created" || b.kind !== "existing") throw new Error();
    expect(b.order.code).toBe(a.order.code);

    const other = await testLearner("B");
    const results = await Promise.all([createOrder(other, SLUG), createOrder(other, SLUG), createOrder(other, SLUG)]);
    expect(results.filter((r) => r.kind === "created")).toHaveLength(1);
    expect(await prisma().order.count({ where: { userId: other.userId } })).toBe(1);
  });

  it("đã có quyền học → already_enrolled", async () => {
    const l = await setup();
    const { rows: [admin] } = await sqlAsMigrator(
      `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at) VALUES ('c@x.vn','owner','active',now(),now()+interval '7 days') RETURNING id`,
    );
    const course = await prisma().course.findUniqueOrThrow({ where: { slug: SLUG } });
    await prisma().enrollment.create({ data: { userId: l.userId, courseId: course.id, source: "grant", grantReason: "tặng", grantedBy: admin.id } });
    expect(await createOrder(l, SLUG)).toEqual({ kind: "already_enrolled" });
  });

  it("mã trùng thì thử lại; trùng 6 lần → OrderCodeExhaustedError", async () => {
    const l = await setup();
    const first = await createOrder(l, SLUG);
    if (first.kind !== "created") throw new Error();
    await sqlAsMigrator(`UPDATE orders SET status = 'expired', expired_at = now()`);
    const taken = first.order.code;
    let calls = 0;
    const retried = await createOrder(l, SLUG, { codeSource: () => (++calls <= 3 ? taken : "MEAAAAAAAA") });
    expect(retried.kind).toBe("created");
    expect(calls).toBe(4);
    await sqlAsMigrator(`UPDATE orders SET status = 'expired', expired_at = now() WHERE status = 'pending'`);
    await expect(createOrder(l, SLUG, { codeSource: () => taken })).rejects.toBeInstanceOf(OrderCodeExhaustedError);
  });
});

describe("hết hạn và xem đơn", () => {
  it("expireOrders: trước hạn 1 giây không đổi; tới hạn → expired", async () => {
    const l = await setup();
    const r = await createOrder(l, SLUG);
    if (r.kind !== "created") throw new Error();
    const shift = (ms: number) => ageOrders(ms);
    await shift(15 * 60_000 - 1_000);
    expect(await expireOrders()).toBe(0);
    await shift(1_000);
    expect(await expireOrders()).toBe(1);
    const order = await prisma().order.findUniqueOrThrow({ where: { code: r.order.code } });
    expect(order.status).toBe("expired");
    expect(order.expiredAt).not.toBeNull();
    expect(await createOrder(l, SLUG)).toMatchObject({ kind: "created" });
  });

  it("GET đơn: của mình → 200; của người khác → 404; không phiên → 401", async () => {
    const l = await setup();
    const r = await createOrder(l, SLUG);
    if (r.kind !== "created") throw new Error();
    const params = { params: Promise.resolve({ code: r.order.code }) };
    expect((await getOrder(learnerRequest(`/api/me/orders/${r.order.code}`, l), params)).status).toBe(200);
    const other = await testLearner("B");
    expect((await getOrder(learnerRequest(`/api/me/orders/${r.order.code}`, other), params)).status).toBe(404);
    expect((await getOrder(new Request(`${process.env.APP_ORIGIN}/api/me/orders/x`), params)).status).toBe(401);
  });
});
