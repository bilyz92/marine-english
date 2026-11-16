import { beforeEach, describe, expect, it } from "vitest";
import { withTx } from "@/lib/db";
import { createUserWithIdentity } from "@/modules/auth-learner/identities";
import { createGuestOrder, guestAccessTokenHash, type GuestOrderInput } from "@/modules/orders/guest";
import { publish, seedContent } from "../helpers/content";
import { ageOrders } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";

// Đơn khách (docs/superpowers/plans/2026-11-16-guest-orders.md, Task 2): chỉ tạo đơn, chưa tạo tài khoản.

const SLUG = "engine_cadet_tanker";
let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
const input = (patch: Partial<GuestOrderInput> = {}): GuestOrderInput => ({
  courseSlug: SLUG, displayName: "Nguyễn Văn Khách", phone: "0912 000 111", email: "khach@x.vn", ip: freshIp(), termsVersion: "v1", ...patch,
});

beforeEach(async () => {
  await seedContent();
  await publish(SLUG, 199_000);
});

describe("createGuestOrder", () => {
  it("creates a pending order with no user and a guest row", async () => {
    const r = await createGuestOrder(input());
    expect(r.kind).toBe("created");
    if (r.kind !== "created") return;
    expect(r.order.amountDueVnd).toBe(199_000);
    expect(r.order.status).toBe("pending");
    const { rows: [o] } = await sqlAsMigrator(
      `SELECT o.user_id, g.display_name, g.phone_canonical, g.email, g.password_hash, g.password_enc, g.access_token_hash, t.terms_version
       FROM orders o JOIN guest_orders g ON g.order_id = o.id JOIN order_terms_acceptances t ON t.order_id = o.id WHERE o.code = $1`, [r.order.code]);
    expect(o.user_id).toBeNull();
    expect(o).toMatchObject({ display_name: "Nguyễn Văn Khách", phone_canonical: "+84912000111", email: "khach@x.vn", terms_version: "v1" });
    expect(o.password_hash).toMatch(/^scrypt\$/);
    expect(o.password_enc).toMatch(/^v1\./);
    expect(o.access_token_hash).toBe(guestAccessTokenHash(r.accessToken));
    expect(o.access_token_hash).not.toBe(r.accessToken);
    const { rows: [n] } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM users`);
    expect(n.n).toBe(0);
  });

  it("rejects a phone that has an account", async () => {
    const { rows: [u] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('Cũ') RETURNING id`);
    await sqlAsMigrator(`INSERT INTO password_logins (user_id, phone_canonical, password_hash) VALUES ($1, '+84912000111', 'scrypt$x')`, [u.id]);
    expect((await createGuestOrder(input())).kind).toBe("phone_taken");
  });

  it("rejects an email that is a verified identity or a contact email", async () => {
    await withTx((tx) => createUserWithIdentity(tx, { kind: "email", value: "khach@x.vn", displayName: "Cũ", rank: null }));
    expect((await createGuestOrder(input({ email: "KHACH@x.vn" }))).kind).toBe("email_taken");
    const { rows: [u] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('Cũ 2') RETURNING id`);
    await sqlAsMigrator(`INSERT INTO learner_contact_emails (user_id, email) VALUES ($1, 'lienhe@x.vn')`, [u.id]);
    expect((await createGuestOrder(input({ phone: "0912000222", email: "lienhe@x.vn" }))).kind).toBe("email_taken");
  });

  it("rejects a second open guest order for the same phone or email", async () => {
    expect((await createGuestOrder(input())).kind).toBe("created");
    expect((await createGuestOrder(input({ email: "khac@x.vn" }))).kind).toBe("pending_order");
    expect((await createGuestOrder(input({ phone: "0912000999" }))).kind).toBe("pending_order");
  });

  it("allows a new order after the first expired", async () => {
    expect((await createGuestOrder(input())).kind).toBe("created");
    await ageOrders(16 * 60_000);
    expect((await createGuestOrder(input())).kind).toBe("created");
  });

  it("throttles the 11th guest order from one IP in an hour", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await createGuestOrder(input({ ip: "10.7.7.7", phone: `09120001${String(i).padStart(2, "0")}`, email: `k${i}@x.vn` }))).kind).toBe("created");
    }
    expect((await createGuestOrder(input({ ip: "10.7.7.7", phone: "0912000199", email: "k99@x.vn" }))).kind).toBe("throttled");
  });

  it("invalid phone, invalid email, course not for sale", async () => {
    expect((await createGuestOrder(input({ phone: "12345" }))).kind).toBe("invalid_phone");
    expect((await createGuestOrder(input({ email: "khong-phai-email" }))).kind).toBe("invalid_email");
    expect((await createGuestOrder(input({ courseSlug: "khong-co" }))).kind).toBe("not_for_sale");
  });

  it("concurrent guest orders with the same email: one wins", async () => {
    const results = await Promise.all([
      createGuestOrder(input({ phone: "0912000301", email: "chung@x.vn" })),
      createGuestOrder(input({ phone: "0912000302", email: "chung@x.vn" })),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "pending_order"]);
  });
});
