import { beforeEach, describe, expect, it } from "vitest";
import { moneyFixture, txCode, type MoneyFixture } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";

// Đơn của khách chưa có tài khoản (docs/superpowers/plans/2026-11-16-guest-orders.md, Task 1): ràng buộc trong DB.

const GUEST = "MEGGGGGGGG";
const HASH = "scrypt$test";
let f: MoneyFixture;

const insertGuestOrder = (code = GUEST, phone = "+84912000111", token = `tok-${code}`): [string, unknown[]][] => [
  [`INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at)
    VALUES ($1, NULL, 199000, 'de-xuat-2026-10', now() + interval '15 minutes')`, [code]],
  [`INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
    SELECT id, $2, $3, 199000, 199000 FROM orders WHERE code = $1`, [code, f.courseId, f.courseVersionId]],
  [`INSERT INTO guest_orders (order_id, display_name, phone_canonical, email, password_hash, password_enc, access_token_hash, created_ip)
    SELECT id, 'Khách', $2, 'khach@x.vn', $3, 'enc', $4, '10.0.0.1' FROM orders WHERE code = $1`, [code, phone, HASH, token]],
];

beforeEach(async () => {
  f = await moneyFixture();
});

describe("guest_orders: ràng buộc", () => {
  it("đơn khách hợp lệ: không user, có dòng guest_orders", async () => {
    expect(await txCode(insertGuestOrder())).toBeNull();
  });

  it("order without user and without guest row is rejected at commit", async () => {
    expect(await txCode(insertGuestOrder().slice(0, 2))).not.toBeNull();
  });

  it("paid order without user is rejected", async () => {
    await txCode(insertGuestOrder());
    expect(await txCode([[`UPDATE orders SET status = 'paid', paid_at = now() WHERE code = $1`, [GUEST]]])).not.toBeNull();
  });

  it("guest_order attempt kind is accepted", async () => {
    expect(await txCode([[`INSERT INTO password_attempts (kind, ip, phone_canonical, ok) VALUES ('guest_order', '10.0.0.1', NULL, false)`]])).toBeNull();
  });

  it("orders_guard: normal order user cannot be set to NULL or changed", async () => {
    await txCode([
      [`INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at)
        VALUES ('ME7K3QX9AB', $1, 199000, 'de-xuat-2026-10', now() + interval '15 minutes')`, [f.userId]],
      [`INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
        SELECT id, $1, $2, 199000, 199000 FROM orders WHERE code = 'ME7K3QX9AB'`, [f.courseId, f.courseVersionId]],
    ]);
    const { rows: [other] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('Khác') RETURNING id`);
    expect(await txCode([[`UPDATE orders SET user_id = NULL WHERE code = 'ME7K3QX9AB'`]])).not.toBeNull();
    expect(await txCode([[`UPDATE orders SET user_id = $1 WHERE code = 'ME7K3QX9AB'`, [other.id]]])).not.toBeNull();
  });

  it("orders_guard: guest order user must match guest_orders.user_id and is set once", async () => {
    await txCode(insertGuestOrder());
    const { rows: [u1] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('U1') RETURNING id`);
    const { rows: [u2] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('U2') RETURNING id`);
    // Chưa đặt guest_orders.user_id → không khớp.
    expect(await txCode([[`UPDATE orders SET user_id = $1 WHERE code = $2`, [u1.id, GUEST]]])).not.toBeNull();
    // Đặt đúng thứ tự: guest_orders trước, rồi orders cùng người.
    expect(await txCode([
      [`UPDATE guest_orders SET user_id = $1 WHERE order_id = (SELECT id FROM orders WHERE code = $2)`, [u1.id, GUEST]],
      [`UPDATE orders SET user_id = $1 WHERE code = $2`, [u1.id, GUEST]],
    ])).toBeNull();
    // Gán lại sang người khác hay về NULL đều bị chặn.
    expect(await txCode([[`UPDATE orders SET user_id = $1 WHERE code = $2`, [u2.id, GUEST]]])).not.toBeNull();
    expect(await txCode([[`UPDATE orders SET user_id = NULL WHERE code = $1`, [GUEST]]])).not.toBeNull();
  });

  it("guest_orders: identity fields immutable, password_enc only cleared, user_id set once, no delete", async () => {
    await txCode(insertGuestOrder());
    const where = `WHERE order_id = (SELECT id FROM orders WHERE code = '${GUEST}')`;
    const { rows: [u1] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('U1') RETURNING id`);
    const { rows: [u2] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('U2') RETURNING id`);
    expect(await txCode([[`UPDATE guest_orders SET email = 'khac@x.vn' ${where}`]])).not.toBeNull();
    expect(await txCode([[`UPDATE guest_orders SET password_enc = 'khac' ${where}`]])).not.toBeNull();
    expect(await txCode([[`DELETE FROM guest_orders ${where}`]])).not.toBeNull();
    // Chưa có tài khoản thì không được bỏ mật khẩu tạm (đường duy nhất để khách đăng nhập).
    expect(await txCode([[`UPDATE guest_orders SET password_enc = NULL ${where}`]])).not.toBeNull();
    expect(await txCode([[`UPDATE guest_orders SET user_id = $1 ${where}`, [u1.id]]])).toBeNull();
    expect(await txCode([[`UPDATE guest_orders SET password_enc = NULL ${where}`]])).toBeNull();
    expect(await txCode([[`UPDATE guest_orders SET user_id = $1 ${where}`, [u2.id]]])).not.toBeNull();
  });
});
