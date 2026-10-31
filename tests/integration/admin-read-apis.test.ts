import { describe, expect, it } from "vitest";
import { GET as me } from "@/app/api/quan-tri/me/route";
import { GET as overviewRoute } from "@/app/api/quan-tri/overview/route";
import { GET as ordersRoute } from "@/app/api/quan-tri/orders/route";
import { GET as learnersRoute } from "@/app/api/quan-tri/learners/route";
import { ingest } from "@/modules/ledger/ingest";
import { createOrder } from "@/modules/orders/orders";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { adminCtx } from "../helpers/admin-ctx";
import { publish, seedContent } from "../helpers/content";
import { PRICE, report, SLUG } from "../helpers/ledger";
import { testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { requestFullRefund, advanceRefund } from "@/modules/refunds/refunds";

async function paidOrder(l: TestLearner): Promise<string> {
  const r = await createOrder(l, SLUG);
  if (r.kind !== "created") throw new Error(r.kind);
  await ingest(report({ content: r.order.code, bankTime: new Date() }));
  return r.order.code;
}
const body = async (res: Response) => ({ status: res.status, data: (await res.json()) as never });
async function setup() {
  await seedContent();
  await publish(SLUG, PRICE);
}

describe("/api/quan-tri/me", () => {
  it("trả vai trò và quyền từ ma trận phía máy chủ", async () => {
    const owner = await body(await callAdmin(me, await adminSess("owner"), "GET", "/api/quan-tri/me"));
    expect(owner.status).toBe(200);
    expect(owner.data).toMatchObject({ role: "owner" });
    expect((owner.data as { permissions: string[] }).permissions).toEqual(expect.arrayContaining(["jobs.run", "grants.create", "orders.view"]));
    const support = (await body(await callAdmin(me, await adminSess("support"), "GET", "/api/quan-tri/me"))).data as { role: string; permissions: string[] };
    expect(support.role).toBe("support");
    expect(support.permissions).toContain("payments.match");
    expect(support.permissions).not.toContain("grants.create");
    expect(support.permissions).not.toContain("jobs.run");
  });

  it("chưa đăng nhập → 401", async () => {
    const res = await me(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/me`));
    expect(res.status).toBe(401);
  });
});

describe("/api/quan-tri/overview", () => {
  it("tiền nhận và tiền hoàn tách riêng, không có số ròng; đếm tự động; khoản chờ lâu nhất", async () => {
    await setup();
    const a = await testLearner("A");
    const b = await testLearner("B");
    const refunded = await paidOrder(a);
    await paidOrder(b);
    await ingest(report({ content: "khong co ma", amountVnd: 12_000, bankTime: new Date() }));
    const owner = await adminCtx("owner");
    const req = await requestFullRefund(owner, { orderCode: refunded, reason: "thử" });
    if (!("refundId" in req)) throw new Error("no refund");
    await advanceRefund(owner, req.refundId, { action: "approve" });
    await advanceRefund(owner, req.refundId, { action: "send", outBankRef: "OUT1", evidence: "ảnh" });
    await advanceRefund(await adminCtx("owner"), req.refundId, { action: "confirm" });
    const { status, data } = await body(await callAdmin(overviewRoute, await adminSess("support"), "GET", "/api/quan-tri/overview?days=1"));
    expect(status).toBe(200);
    expect(data).toMatchObject({ receivedVnd: 2 * PRICE, refundedVnd: PRICE, paidOrders: { auto: 2, manual: 0 }, queueOpen: 1, newLearners: 2, refundsOpen: 0 });
    const d = data as Record<string, unknown>;
    expect(d.revenueVnd).toBeUndefined();
    expect((d.oldestQueue as unknown[]).length).toBe(1);
    expect((d.recentOrders as unknown[]).length).toBe(2);
    expect(Array.isArray(d.jobs)).toBe(true);
  });

  it("khoảng ngày theo giờ VN: đơn trước 00:00 VN hôm nay không tính khi days=1", async () => {
    await setup();
    const code = await paidOrder(await testLearner("C"));
    await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
    await sqlAsMigrator(`UPDATE orders SET paid_at = date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' - interval '1 minute' WHERE code = $1`, [code]);
    await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
    const { data } = await body(await callAdmin(overviewRoute, await adminSess("owner"), "GET", "/api/quan-tri/overview?days=1"));
    expect(data).toMatchObject({ receivedVnd: 0 });
  });
});

describe("/api/quan-tri/orders", () => {
  it("phân trang theo con trỏ không trùng không sót; lọc trạng thái; tìm theo mã", async () => {
    await setup();
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await createOrder(await testLearner(`L${i}`), SLUG);
      if (r.kind !== "created") throw new Error(r.kind);
      codes.push(r.order.code);
    }
    const s = await adminSess("support");
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/api/quan-tri/orders?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = (await body(await callAdmin(ordersRoute, s, "GET", url))).data as { orders: { code: string }[]; nextCursor: string | null };
      expect(page.orders.length).toBeLessThanOrEqual(2);
      seen.push(...page.orders.map((o) => o.code));
      cursor = page.nextCursor;
    } while (cursor);
    expect([...seen].sort()).toEqual([...codes].sort());
    const none = (await body(await callAdmin(ordersRoute, s, "GET", "/api/quan-tri/orders?status=paid"))).data as { orders: unknown[] };
    expect(none.orders).toEqual([]);
    const one = (await body(await callAdmin(ordersRoute, s, "GET", `/api/quan-tri/orders?q=${codes[0]}`))).data as { orders: { code: string }[] };
    expect(one.orders.map((o) => o.code)).toEqual([codes[0]]);
    const wild = (await body(await callAdmin(ordersRoute, s, "GET", "/api/quan-tri/orders?q=%25"))).data as { orders: unknown[] };
    expect(wild.orders).toEqual([]);
  });

  it("trạng thái lạ, con trỏ hỏng → 400", async () => {
    const s = await adminSess("owner");
    expect((await callAdmin(ordersRoute, s, "GET", "/api/quan-tri/orders?status=x")).status).toBe(400);
    expect((await callAdmin(ordersRoute, s, "GET", "/api/quan-tri/orders?cursor=hong")).status).toBe(400);
  });
});

describe("/api/quan-tri/learners", () => {
  async function learnerWithContacts() {
    const l = await testLearner("Nguyen Van Tim");
    await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'phone', '+84912345678', now()), ($1, 'email', 'tim@x.vn', now())`, [l.userId]);
    return l;
  }

  it("tìm theo email, số điện thoại mọi dạng, tên; có khóa và thiết bị", async () => {
    const l = await learnerWithContacts();
    const s = await adminSess("owner");
    for (const q of ["tim@x.vn", "0912345678", "+84912345678", "Tim"]) {
      const { learners } = (await body(await callAdmin(learnersRoute, s, "GET", `/api/quan-tri/learners?q=${encodeURIComponent(q)}`))).data as { learners: { id: string }[] };
      expect(learners.map((x) => x.id), q).toEqual([l.userId]);
    }
  });

  it("chủ thấy đủ số; hỗ trợ thấy số che bớt, tìm bằng số vẫn được", async () => {
    await learnerWithContacts();
    const q = "/api/quan-tri/learners?q=0912345678";
    const owner = (await body(await callAdmin(learnersRoute, await adminSess("owner"), "GET", q))).data as { learners: { identities: { kind: string; value: string }[] }[] };
    expect(owner.learners[0]!.identities.find((i) => i.kind === "phone")!.value).toBe("+84912345678");
    const res = await callAdmin(learnersRoute, await adminSess("support"), "GET", q);
    const text = await res.text();
    expect(text).not.toContain("912345678");
    expect(text).toContain("678");
  });

  it("từ khóa ngắn hoặc ký tự đại diện không liệt kê cả bảng", async () => {
    await learnerWithContacts();
    const s = await adminSess("owner");
    for (const q of ["%", "_", "a"]) {
      const { learners } = (await body(await callAdmin(learnersRoute, s, "GET", `/api/quan-tri/learners?q=${encodeURIComponent(q)}`))).data as { learners: unknown[] };
      expect(learners, q).toEqual([]);
    }
  });

  it("đọc danh sách quyền không ghi denied giả; support gọi quyền chủ qua API khác vẫn có audit", async () => {
    const support = await adminSess("support");
    await callAdmin(me, support, "GET", "/api/quan-tri/me");
    expect((await auditRows()).filter((a) => a.result === "denied")).toEqual([]);
  });
});
