import type { Client } from "pg";
import { errCode, pgAs } from "./pg";
import { sqlAsMigrator } from "./otp";
import { publish, seedContent } from "./content";

export const CODE = "ME7K3QX9AB";

/** Học viên + khóa tanker đã mở bán; trả id. */
export async function moneyFixture() {
  const courses = await seedContent();
  await publish("engine_cadet_tanker", 199_000);
  const { rows: [user] } = await sqlAsMigrator(`INSERT INTO users (display_name) VALUES ('HV') RETURNING id`);
  const { rows: [owner] } = await sqlAsMigrator(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at)
     VALUES ('chu@x.vn', 'owner', 'active', now(), now() + interval '7 days', now()) RETURNING id`,
  );
  const { rows: [owner2] } = await sqlAsMigrator(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at, activated_at)
     VALUES ('chu2@x.vn', 'owner', 'active', now(), now() + interval '7 days', now()) RETURNING id`,
  );
  const { rows: [cv] } = await sqlAsMigrator(`SELECT current_version_id FROM courses WHERE slug = 'engine_cadet_tanker'`);
  return { userId: user.id as string, courseId: courses.engine_cadet_tanker!, courseVersionId: cv.current_version_id as string, ownerId: owner.id as string, owner2Id: owner2.id as string };
}

export type MoneyFixture = Awaited<ReturnType<typeof moneyFixture>>;

/** Chạy các câu lệnh trong một transaction bằng me_app; trả mã lỗi (kể cả lỗi lúc COMMIT) hoặc null. */
export async function txCode(statements: [string, unknown[]?][]): Promise<string | null> {
  const app = await pgAs("app");
  try {
    await app.query("BEGIN");
    for (const [sql, params] of statements) {
      const code = await errCode(app, sql, params ?? []);
      if (code) {
        await app.query("ROLLBACK");
        return code;
      }
    }
    const code = await errCode(app, "COMMIT");
    return code;
  } finally {
    await app.end();
  }
}

export function insertOrderSql(f: MoneyFixture, code = CODE, amount = 199_000, itemPrice = amount): [string, unknown[]][] {
  return [
    [
      `INSERT INTO orders (code, user_id, amount_due_vnd, refund_policy_version, expires_at)
       VALUES ($1, $2, $3, 'de-xuat-2026-10', now() + interval '15 minutes')`,
      [code, f.userId, amount],
    ],
    [
      `INSERT INTO order_items (order_id, course_id, course_version_id, list_price_vnd, final_price_vnd)
       SELECT id, $2, $3, $4, $4 FROM orders WHERE code = $1`,
      [code, f.courseId, f.courseVersionId, itemPrice],
    ],
  ];
}

export async function insertBankTx(app: Client | null, input: { ref: string; amount?: number; source?: string; enteredBy?: string }) {
  const client = app ?? (await pgAs("app"));
  try {
    const manual = input.source === "manual";
    const { rows } = await client.query(
      `INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source, entered_by, evidence)
       VALUES ('VCB', '0123456789', $1, $2, 'ck', now(), $3, $4, $5) RETURNING id`,
      [input.ref, input.amount ?? 199_000, input.source ?? "sepay_webhook", manual ? input.enteredBy : null, manual ? "ảnh sao kê" : null],
    );
    return rows[0].id as string;
  } finally {
    if (!app) await client.end();
  }
}

/** Lùi created_at/expires_at của mọi đơn (giả lập thời gian trôi). Tắt trigger bất biến trong cùng transaction của migrator. */
export async function ageOrders(ms: number, where = "TRUE") {
  const client = await pgAs("migrator");
  try {
    await client.query("BEGIN");
    await client.query(`ALTER TABLE orders DISABLE TRIGGER orders_guard`);
    await client.query(
      `UPDATE orders SET created_at = created_at - make_interval(secs => $1::double precision / 1000),
         expires_at = expires_at - make_interval(secs => $1::double precision / 1000) WHERE ${where}`,
      [ms],
    );
    await client.query(`ALTER TABLE orders ENABLE TRIGGER orders_guard`);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
}
