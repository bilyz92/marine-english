import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dailySummary } from "@/modules/jobs/daily-summary";
import { isDue, JOBS } from "@/modules/jobs/definitions";
import { runJob } from "@/modules/jobs/runner";
import { insertBankTx, insertOrderSql, moneyFixture, type MoneyFixture } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

const vn = (time: string, day = "2026-10-31") => new Date(`${day}T${time}:00+07:00`);
const job = JOBS.find((j) => j.name === "me.summary.daily")!;
let f: MoneyFixture;
let seq = 0;

async function paidOrder(paidAt: Date, amount = 199_000) {
  const code = `MEABCDEFG${"HJKMNPQRST"[++seq % 10]}`;
  const pg = await pgAs("app");
  try {
    await pg.query("BEGIN");
    for (const [sql, params] of insertOrderSql(f, code, amount)) await pg.query(sql, params);
    await pg.query("COMMIT");
  } finally {
    await pg.end();
  }
  const { rows: [order] } = await sqlAsMigrator(`SELECT id FROM orders WHERE code = $1`, [code]);
  await sqlAsMigrator(`ALTER TABLE orders DISABLE TRIGGER USER`);
  await sqlAsMigrator(`UPDATE orders SET status = 'paid', paid_at = $2 WHERE id = $1`, [order.id, paidAt]);
  await sqlAsMigrator(`ALTER TABLE orders ENABLE TRIGGER USER`);
  return order.id as string;
}

beforeEach(async () => {
  f = await moneyFixture();
});

describe("tổng kết hằng ngày", () => {
  it("đếm theo ngày giờ VN: 23:30 VN hôm trước không tính, 00:10 hôm nay có", async () => {
    await paidOrder(vn("23:30", "2026-10-30"));
    await paidOrder(vn("00:10"), 100_000);
    await paidOrder(vn("20:59"), 300_000);
    const s = await dailySummary(vn("21:00"));
    expect(s).toMatchObject({ day: "2026-10-31", paidOrders: 2, revenueVnd: 400_000, refunds: 0, queueOpen: 0, outboxDead: 0 });
  });

  it("đếm hoàn tiền đã xác nhận trong ngày, khoản chờ xử lý tay, thông báo hỏng", async () => {
    const order = await paidOrder(vn("10:00"), 50_000);
    await sqlAsMigrator(`ALTER TABLE refunds DISABLE TRIGGER USER`);
    await sqlAsMigrator(
      `INSERT INTO refunds (order_id, kind, amount_vnd, status, reason, out_bank_ref, confirmed_at) VALUES ($1, 'full', 50000, 'confirmed', 'x', 'R1', $2)`,
      [order, vn("11:00")],
    );
    await sqlAsMigrator(`ALTER TABLE refunds ENABLE TRIGGER USER`);
    await sqlAsMigrator(`INSERT INTO outbox_events (dedup_key, kind, channel, payload, status) VALUES ('hong', 'order_paid', 'email', '{}', 'dead')`);
    await insertBankTx(null, { ref: "CHO-1", amount: 123_000 });
    const s = await dailySummary(vn("21:00"));
    expect(s.queueOpen).toBe(1);
    expect(s.refunds).toBe(1);
    expect(s.outboxDead).toBe(1);
  });

  it("job chạy hai lần cùng ngày → một outbox, khóa theo ngày VN", async () => {
    expect(await runJob(job, "w1")).toMatchObject({ status: "success" });
    expect(await runJob(job, "w1")).toMatchObject({ status: "success" });
    const rows = await prisma().outboxEvent.findMany({ where: { kind: "daily_summary" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe("telegram");
    expect(rows[0]!.dedupKey).toMatch(/^daily_summary:\d{4}-\d{2}-\d{2}$/);
  });

  it("lịch 21:00 VN; worker lên lúc 21:05 vẫn gửi", () => {
    expect(job.schedule).toEqual({ dailyAt: "21:00" });
    expect(isDue(job, vn("21:00", "2026-10-30"), vn("21:05"))).toBe(true);
  });
});
