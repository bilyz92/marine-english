import { describe, expect, it } from "vitest";
import { errCode, pgAs } from "../helpers/pg";
import { sqlAsMigrator } from "../helpers/otp";
import { CODE, insertBankTx, insertOrderSql, moneyFixture, txCode } from "../helpers/money";

const orderId = async () => (await sqlAsMigrator(`SELECT id FROM orders WHERE code = $1`, [CODE])).rows[0].id as string;

async function app<T>(run: (c: import("pg").Client) => Promise<T>) {
  const c = await pgAs("app");
  try {
    return await run(c);
  } finally {
    await c.end();
  }
}

describe("orders", () => {
  it("tạo đơn hợp lệ; tổng item khác số phải trả → lỗi khi commit", async () => {
    const f = await moneyFixture();
    expect(await txCode(insertOrderSql(f, CODE, 199_000, 150_000))).toBe("P0001");
    expect(await txCode(insertOrderSql(f))).toBeNull();
  });

  it("mã đơn sai bảng ký tự, expires_at khác 15 phút → CHECK", async () => {
    const f = await moneyFixture();
    expect(await txCode(insertOrderSql(f, "ME0K3QX9AB"))).toBe("23514");
    expect(
      await txCode([[`INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at) VALUES ('MEAAAAAAAA', $1, 1000, 'x', now() + interval '16 minutes')`, [f.userId]]]),
    ).toBe("23514");
  });

  it("cột bất biến và chuyển trạng thái", async () => {
    const f = await moneyFixture();
    await txCode(insertOrderSql(f));
    await app(async (c) => {
      expect(await errCode(c, `UPDATE orders SET amount_due_vnd = 1 WHERE code = $1`, [CODE])).toBe("P0001");
      expect(await errCode(c, `UPDATE orders SET status = 'refunded', paid_at = now(), refunded_at = now() WHERE code = $1`, [CODE])).toBe("P0001");
      expect(await errCode(c, `UPDATE orders SET status = 'expired', expired_at = now() WHERE code = $1`, [CODE])).toBeNull();
      expect(await errCode(c, `UPDATE orders SET status = 'paid', paid_at = now() WHERE code = $1`, [CODE])).toBeNull();
      expect(await errCode(c, `UPDATE orders SET status = 'pending', paid_at = NULL WHERE code = $1`, [CODE])).toBe("P0001");
      expect(await errCode(c, `UPDATE orders SET status = 'refunded', refunded_at = now() WHERE code = $1`, [CODE])).toBeNull();
      expect(await errCode(c, `UPDATE orders SET status = 'paid', refunded_at = NULL WHERE code = $1`, [CODE])).toBe("P0001");
      expect(await errCode(c, `UPDATE order_items SET final_price_vnd = 1`)).not.toBeNull();
      expect(await errCode(c, `DELETE FROM orders`)).toBe("42501");
    });
  });
});

describe("bank_transactions và kết quả xử lý", () => {
  it("trùng định danh → 23505; UPDATE → lỗi; bank_ref chữ thường → CHECK; manual cần người nhập + bằng chứng", async () => {
    await moneyFixture();
    await insertBankTx(null, { ref: "FT1" });
    await app(async (c) => {
      expect(await errCode(c, `INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source) VALUES ('VCB','0123456789','FT1',1,'',now(),'sepay_webhook')`)).toBe("23505");
      expect(await errCode(c, `INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source) VALUES ('VCB','0123456789','ft2',1,'',now(),'sepay_webhook')`)).toBe("23514");
      expect(await errCode(c, `INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source) VALUES ('VCB','0123456789','FT3',1,'',now(),'manual')`)).toBe("23514");
      expect(await errCode(c, `UPDATE bank_transactions SET amount_vnd = 2`)).not.toBeNull();
      expect(await errCode(c, `UPDATE bank_transactions SET id = id`)).toBe("P0001");
      expect(await errCode(c, `SELECT id FROM bank_transactions FOR UPDATE`)).toBeNull();
      expect(await errCode(c, `DELETE FROM bank_transactions`)).toBe("42501");
    });
  });

  it("chủ không tự xác minh dòng mình nhập", async () => {
    const f = await moneyFixture();
    const id = await insertBankTx(null, { ref: "FT9", source: "manual", enteredBy: f.ownerId });
    expect(await txCode([[`INSERT INTO bank_transaction_verifications (bank_transaction_id, method, verified_by, evidence) VALUES ($1, 'owner', $2, 'x')`, [id, f.ownerId]]])).toBe("P0001");
    expect(await txCode([[`INSERT INTO bank_transaction_verifications (bank_transaction_id, method, verified_by, evidence) VALUES ($1, 'owner', $2, 'x')`, [id, f.owner2Id]]])).toBeNull();
  });

  it("phân bổ một lần; phân bổ và kết luận loại trừ nhau; số tiền phân bổ = số tiền dòng sổ", async () => {
    const f = await moneyFixture();
    await txCode(insertOrderSql(f));
    const oid = await orderId();
    const a = await insertBankTx(null, { ref: "FTA" });
    const b = await insertBankTx(null, { ref: "FTB" });
    const alloc = (tx: string, amount = 199_000): [string, unknown[]] => [`INSERT INTO payment_allocations (bank_transaction_id, order_id, amount_vnd, kind) VALUES ($1, $2, $3, 'auto')`, [tx, oid, amount]];
    expect(await txCode([alloc(a, 100)])).toBe("P0001");
    expect(await txCode([alloc(a)])).toBeNull();
    expect(await txCode([alloc(a)])).toBe("23505");
    expect(await txCode([[`INSERT INTO bank_transaction_dispositions (bank_transaction_id, kind, reason, decided_by) VALUES ($1, 'ignored', 'x', $2)`, [a, f.ownerId]]])).toBe("P0001");
    expect(await txCode([[`INSERT INTO bank_transaction_dispositions (bank_transaction_id, kind, reason, decided_by) VALUES ($1, 'ignored', 'x', $2)`, [b, f.ownerId]]])).toBeNull();
    expect(await txCode([alloc(b)])).toBe("P0001");
    expect(await app((c) => errCode(c, `UPDATE payment_allocations SET amount_vnd = 1`))).not.toBeNull();
  });
});

describe("refunds", () => {
  async function paidOrder(extra = 0) {
    const f = await moneyFixture();
    await txCode(insertOrderSql(f));
    const oid = await orderId();
    const tx = await insertBankTx(null, { ref: "FTP", amount: 199_000 + extra });
    expect(await txCode([
      [`INSERT INTO payment_allocations (bank_transaction_id, order_id, amount_vnd, kind) VALUES ($1, $2, $3, 'auto')`, [tx, oid, 199_000 + extra]],
      [`UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1`, [oid]],
    ])).toBeNull();
    return { f, oid, tx };
  }
  const refund = (oid: string, kind: string, amount: number, tx: string, by: string): [string, unknown[]][] => [
    [`INSERT INTO refunds (id, order_id, kind, amount_vnd, reason, requested_by) VALUES ('00000000-0000-0000-0000-00000000000${kind === "full" ? 1 : 2}', $1, $2, $3, 'lý do', $4)`, [oid, kind, amount, by]],
    [`INSERT INTO refund_sources (refund_id, bank_transaction_id, amount_vnd) VALUES ('00000000-0000-0000-0000-00000000000${kind === "full" ? 1 : 2}', $1, $2)`, [tx, amount]],
  ];

  it("full phải bằng số phải trả; nguồn phải là dòng sổ của đơn; vượt tiền dòng sổ → lỗi", async () => {
    const { f, oid, tx } = await paidOrder();
    expect(await txCode(refund(oid, "full", 100_000, tx, f.ownerId))).toBe("P0001");
    const other = await insertBankTx(null, { ref: "FTX" });
    expect(await txCode(refund(oid, "full", 199_000, other, f.ownerId))).toBe("P0001");
    expect(await txCode(refund(oid, "full", 199_000, tx, f.ownerId))).toBeNull();
  });

  it("excess ≤ phần thừa thực tế; hai full hiệu lực → 23505", async () => {
    const { f, oid, tx } = await paidOrder(50_000);
    expect(await txCode(refund(oid, "excess", 60_000, tx, f.ownerId))).toBe("P0001");
    expect(await txCode(refund(oid, "excess", 50_000, tx, f.ownerId))).toBeNull();
  });

  it("chuyển trạng thái refund và out_bank_ref", async () => {
    const { f, oid, tx } = await paidOrder();
    await txCode(refund(oid, "full", 199_000, tx, f.ownerId));
    await app(async (c) => {
      expect(await errCode(c, `UPDATE refunds SET status = 'sent', out_bank_ref = 'OUT1'`)).toBe("P0001");
      expect(await errCode(c, `UPDATE refunds SET status = 'approved'`)).toBeNull();
      expect(await errCode(c, `UPDATE refunds SET status = 'sent'`)).toBe("23514");
      expect(await errCode(c, `UPDATE refunds SET status = 'sent', out_bank_ref = 'OUT1'`)).toBeNull();
      expect(await errCode(c, `UPDATE refunds SET amount_vnd = 1`)).toBe("P0001");
      expect(await errCode(c, `INSERT INTO refunds (order_id, kind, amount_vnd, reason) VALUES ($1, 'full', 199000, 'x')`, [oid])).toBe("23505");
    });
  });
});

describe("enrollments và outbox", () => {
  it("CHECK nguồn; chỉ sửa được cột thu hồi; outbox chống trùng", async () => {
    const f = await moneyFixture();
    await app(async (c) => {
      expect(await errCode(c, `INSERT INTO enrollments (user_id, course_id, source) VALUES ($1, $2, 'order')`, [f.userId, f.courseId])).toBe("23514");
      expect(await errCode(c, `INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by) VALUES ($1, $2, 'grant', 'tặng', $3)`, [f.userId, f.courseId, f.ownerId])).toBeNull();
      expect(await errCode(c, `UPDATE enrollments SET course_id = course_id`)).toBeNull();
      expect(await errCode(c, `UPDATE enrollments SET grant_reason = 'khác'`)).toBe("P0001");
      expect(await errCode(c, `UPDATE enrollments SET revoked_at = now(), revoked_reason = 'x'`)).toBeNull();
      expect(await errCode(c, `INSERT INTO outbox_events (dedup_key, kind, channel, payload) VALUES ('k', 'order_paid', 'telegram', '{}')`)).toBeNull();
      expect(await errCode(c, `INSERT INTO outbox_events (dedup_key, kind, channel, payload) VALUES ('k', 'order_paid', 'telegram', '{}')`)).toBe("23505");
      expect(await errCode(c, `DELETE FROM enrollments`)).toBe("42501");
    });
  });
});


describe("ảnh chụp đơn không mở rộng được (Codex #3)", () => {
  it("chèn thêm dòng hàng sau khi tạo đơn, trùng khóa, hoặc phiên bản khóa khác → lỗi", async () => {
    const f = await moneyFixture();
    expect(await txCode(insertOrderSql(f))).toBeNull();
    const extra: [string, unknown[]] = [
      `INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
       SELECT id, $2, $3, 1000, 1000 FROM orders WHERE code = $1`,
      [CODE, f.courseId, f.courseVersionId],
    ];
    expect(await txCode([extra])).not.toBeNull();
    const { rows: [other] } = await sqlAsMigrator(`SELECT id, current_version_id FROM courses WHERE slug = 'engine_cadet_dry_cargo'`);
    expect(await txCode([
      [`INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at) VALUES ('MEBBBBBBBB', $1, 199000, 'x', now() + interval '15 minutes')`, [f.userId]],
      [`INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd) SELECT id, $1, $2, 199000, 199000 FROM orders WHERE code = 'MEBBBBBBBB'`, [f.courseId, other.current_version_id]],
    ])).toBe("P0001");
  });
});
