import { beforeEach, describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { createUserWithIdentity } from "@/modules/auth-learner/identities";
import { loginWithPassword } from "@/modules/auth-learner/password";
import { readPendingCredentials } from "@/modules/auth-learner/pending-credentials";
import { settleOrder } from "@/modules/enrollments/enroll";
import { ingest } from "@/modules/ledger/ingest";
import { matchTransfers } from "@/modules/ledger/match";
import { approveTransfer } from "@/modules/orders/claims";
import { createGuestOrder, GuestBlockedError, type GuestOrderInput } from "@/modules/orders/guest";
import { expireOrders } from "@/modules/orders/orders";
import { deliverBatch, type Senders } from "@/modules/outbox/deliver";
import { adminCtx } from "../helpers/admin-ctx";
import { publish, seedContent } from "../helpers/content";
import { PRICE, report, SLUG } from "../helpers/ledger";
import { ageOrders } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";

// Tạo tài khoản khi nhận tiền (docs/superpowers/plans/2026-11-16-guest-orders.md, Task 3).

let ipSeq = 0;
const freshIp = () => `10.10.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

async function guestOrder(patch: Partial<GuestOrderInput> = {}) {
  const r = await createGuestOrder({
    courseSlug: SLUG, displayName: "Nguyễn Văn Khách", phone: "0912000111", email: "khach@x.vn", ip: freshIp(), termsVersion: "v1", ...patch,
  });
  if (r.kind !== "created") throw new Error(r.kind);
  const o = await prisma().order.findUniqueOrThrow({ where: { code: r.order.code } });
  return { code: o.code, id: o.id, createdAt: o.createdAt };
}
/** Tiền về đúng đơn, giờ ngân hàng trong cửa sổ 15 phút của đơn. */
const pay = (o: { code: string; createdAt: Date }, patch: Parameters<typeof report>[0] = {}) =>
  ingest(report({ content: o.code, bankTime: new Date(o.createdAt.getTime() + 60_000), ...patch }));
/** Đẩy đơn cũ qua hạn để tạo được đơn mới cùng số/email (giờ ngân hàng vẫn tính theo cửa sổ của đơn cũ). */
async function expireAll() {
  await ageOrders(16 * 60_000);
  await expireOrders();
}
const usersCount = async () => (await sqlAsMigrator(`SELECT count(*)::int AS n FROM users`)).rows[0].n as number;
const orderRow = async (code: string) => (await sqlAsMigrator(`SELECT status, user_id FROM orders WHERE code = $1`, [code])).rows[0];
const lastReason = async () =>
  (await sqlAsMigrator(`SELECT result, reason FROM bank_transaction_classifications ORDER BY created_at DESC LIMIT 1`)).rows[0];
function fakeMail() {
  const mail: { to: string; body: string }[] = [];
  const senders: Senders = { telegram: { send: async () => undefined }, email: { send: async (to, _s, body) => { mail.push({ to, body }); } } };
  return { mail, senders };
}

beforeEach(async () => {
  await seedContent();
  await publish(SLUG, PRICE);
});

describe("đơn khách: nhận tiền thì tạo tài khoản", () => {
  it("SePay payment of a guest order creates the account, enrollment and one order_paid email", async () => {
    const o = await guestOrder();
    expect(await pay(o)).toBe("confirmed");
    const row = await orderRow(o.code);
    expect(row.status).toBe("paid");
    const { rows: [u] } = await sqlAsMigrator(
      `SELECT u.display_name, p.phone_canonical, p.must_change, g.user_id AS guest_user, g.password_enc
       FROM users u JOIN password_logins p ON p.user_id = u.id JOIN guest_orders g ON g.user_id = u.id WHERE u.id = $1`, [row.user_id]);
    expect(u).toMatchObject({ display_name: "Nguyễn Văn Khách", phone_canonical: "+84912000111", must_change: true, guest_user: row.user_id, password_enc: null });
    const creds = await readPendingCredentials(row.user_id);
    expect(creds?.phone).toBe("0912000111");
    expect((await loginWithPassword({ phone: "0912000111", password: creds!.password, ip: freshIp() }, async () => "ok")).kind).toBe("set_password");
    const { rows: enr } = await sqlAsMigrator(`SELECT user_id FROM enrollments WHERE order_id = $1 AND revoked_at IS NULL`, [o.id]);
    expect(enr.map((e) => e.user_id)).toEqual([row.user_id]);
    const emails = await prisma().outboxEvent.findMany({ where: { kind: "order_paid", channel: "email" } });
    expect(emails).toHaveLength(1);
    expect((emails[0]!.payload as { userId: string }).userId).toBe(row.user_id);
    expect(JSON.stringify(emails[0]!.payload)).not.toContain(creds!.password);
  });

  it("email body contains the temporary password and the phone", async () => {
    const o = await guestOrder();
    await pay(o);
    const creds = await readPendingCredentials((await orderRow(o.code)).user_id);
    const { mail, senders } = fakeMail();
    await deliverBatch(senders);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("khach@x.vn");
    expect(mail[0]!.body).toContain("0912000111");
    expect(mail[0]!.body).toContain(creds!.password);
  });

  it("replayed webhook creates one account", async () => {
    const o = await guestOrder();
    const r = report({ content: o.code, bankTime: new Date(o.createdAt.getTime() + 60_000) });
    expect(await ingest(r)).toBe("confirmed");
    expect(await ingest(r)).not.toBe("confirmed");
    expect(await usersCount()).toBe(1);
    expect(await prisma().outboxEvent.count({ where: { kind: "order_paid", channel: "email" } })).toBe(1);
  });

  it("late money inside the window pays an expired guest order", async () => {
    const o = await guestOrder();
    await expireAll();
    expect((await orderRow(o.code)).status).toBe("expired");
    expect(await pay(o, { bankTime: new Date(o.createdAt.getTime() - 16 * 60_000 + 60_000) })).toBe("confirmed");
    expect((await orderRow(o.code)).status).toBe("paid");
    expect(await usersCount()).toBe(1);
  });

  it("second paid guest order with same phone is queued as guest_conflict", async () => {
    const a = await guestOrder({ email: "a@x.vn" });
    await expireAll();
    const b = await guestOrder({ email: "b@x.vn" });
    expect(await pay(b)).toBe("confirmed");
    // Tiền của đơn cũ tới muộn nhưng giờ ngân hàng trong cửa sổ của đơn đó.
    expect(await pay(a, { bankTime: new Date(a.createdAt.getTime() - 16 * 60_000 + 60_000) })).toBe("queued");
    expect(await lastReason()).toEqual({ result: "queue", reason: "guest_conflict" });
    expect(await orderRow(a.code)).toEqual({ status: "expired", user_id: null });
    expect(await usersCount()).toBe(1);
  });

  it("manual match of a conflicting guest order is rejected with guest_conflict", async () => {
    const a = await guestOrder({ email: "a@x.vn" });
    await expireAll();
    const b = await guestOrder({ email: "b@x.vn" });
    await pay(b);
    await pay(a, { bankTime: new Date(a.createdAt.getTime() - 16 * 60_000 + 60_000) });
    const { rows: [bt] } = await sqlAsMigrator(`SELECT bank_transaction_id AS id FROM bank_transaction_classifications WHERE reason = 'guest_conflict'`);
    const r = await matchTransfers(await adminCtx("owner"), { orderCode: a.code, bankTransactionIds: [bt.id], note: "ghép", evidence: "sao kê" });
    expect(r).toEqual({ result: "rejected", reason: "guest_conflict" });
    expect(await orderRow(a.code)).toEqual({ status: "expired", user_id: null });
  });

  it("owner approval of a conflicting guest order is refused and writes no ledger row", async () => {
    const a = await guestOrder({ email: "a@x.vn" });
    await expireAll();
    const b = await guestOrder({ email: "b@x.vn" });
    await pay(b);
    const before = await prisma().bankTransaction.count();
    const r = await approveTransfer(await adminCtx("owner"), { orderCode: a.code, bankRef: "FT-DUYET", note: "", bankTime: new Date() });
    expect(r).toEqual({ result: "rejected", reason: "guest_conflict" });
    expect(await prisma().bankTransaction.count()).toBe(before);
  });

  it("owner approval of a guest order without conflict creates the account", async () => {
    const o = await guestOrder();
    const r = await approveTransfer(await adminCtx("owner"), { orderCode: o.code, bankRef: "FT-DUYET-2", note: "", bankTime: new Date() });
    expect(r).toEqual({ result: "paid" });
    expect((await orderRow(o.code)).user_id).not.toBeNull();
  });

  it("settleOrder throws GuestBlockedError(guest_conflict) for a conflicting guest order whatever the caller", async () => {
    const a = await guestOrder({ email: "a@x.vn" });
    await expireAll();
    const b = await guestOrder({ email: "b@x.vn" });
    await pay(b);
    const before = { allocations: await prisma().paymentAllocation.count(), enrollments: await prisma().enrollment.count(), users: await usersCount() };
    await expect(withTx((tx) => settleOrder(tx, { orderId: a.id, bankTransactionIds: [], kind: "manual" }))).rejects.toMatchObject({ reason: "guest_conflict" });
    expect({ allocations: await prisma().paymentAllocation.count(), enrollments: await prisma().enrollment.count(), users: await usersCount() }).toEqual(before);
  });

  it("a temporary password that cannot be opened queues the money as guest_credentials and writes no account", async () => {
    const o = await guestOrder();
    // Bản niêm phong hỏng (như khóa mã hóa đã gỡ): tắt trigger bảo vệ trong một transaction của migrator để làm hỏng dữ liệu.
    await sqlAsMigrator(`BEGIN; ALTER TABLE guest_orders DISABLE TRIGGER guest_orders_guard;
      UPDATE guest_orders SET password_enc = 'v1.khong-co.AAAA.AAAA.AAAA' WHERE order_id = '${o.id}';
      ALTER TABLE guest_orders ENABLE TRIGGER guest_orders_guard; COMMIT;`);
    expect(await pay(o)).toBe("queued");
    expect(await lastReason()).toEqual({ result: "queue", reason: "guest_credentials" });
    expect(await orderRow(o.code)).toEqual({ status: "pending", user_id: null });
    expect(await usersCount()).toBe(0);
    const err = await withTx((tx) => settleOrder(tx, { orderId: o.id, bankTransactionIds: [], kind: "manual" })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuestBlockedError);
    expect((err as GuestBlockedError).reason).toBe("guest_credentials");
  });

  it("concurrent settlement of two guest orders with the same email creates one account", async () => {
    const a = await guestOrder({ phone: "0912000201", email: "chung@x.vn" });
    await expireAll();
    const b = await guestOrder({ phone: "0912000202", email: "chung@x.vn" });
    const outcomes = await Promise.all([
      pay(a, { bankTime: new Date(a.createdAt.getTime() - 16 * 60_000 + 60_000) }),
      pay(b),
    ]);
    expect(outcomes.sort()).toEqual(["confirmed", "queued"]);
    expect(await usersCount()).toBe(1);
  });

  for (const kind of ["email", "phone"] as const) {
    it(`settlement racing a verified ${kind} link: the identity committed first wins, no second account`, async () => {
      const o = await guestOrder();
      const value = kind === "email" ? "khach@x.vn" : "+84912000111";
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      let started!: () => void;
      const ready = new Promise<void>((r) => { started = r; });
      // Giao dịch gắn danh tính đã xác minh giữ khóa tới khi mở cổng.
      const link = withTx(async (tx) => {
        await createUserWithIdentity(tx, { kind, value, displayName: "Người khác", rank: null });
        started();
        await gate;
      });
      await ready;
      const paying = pay(o);
      await new Promise((r) => setTimeout(r, 300));
      release();
      await link;
      expect(await paying).toBe("queued");
      expect(await lastReason()).toEqual({ result: "queue", reason: "guest_conflict" });
      expect(await usersCount()).toBe(1);
    });
  }
});
