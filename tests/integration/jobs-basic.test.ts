import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { acquireLease, LeaseLostError } from "@/modules/jobs/lease";
import { runJob } from "@/modules/jobs/runner";
import { isDue, JOBS } from "@/modules/jobs/definitions";
import { ageOrders, insertOrderSql, moneyFixture } from "../helpers/money";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

const job = (name: string) => JOBS.find((j) => j.name === name)!;
// 21:00 giờ Việt Nam (UTC+7) ngày 31/10 là 14:00 UTC.
const vn = (time: string, day = "2026-10-31") => new Date(`${day}T${time}:00+07:00`);

describe("isDue", () => {
  it("chưa chạy lần nào → đến hạn với lịch lặp", () => {
    expect(isDue({ schedule: { everyMs: 60_000 } }, null, vn("10:00"))).toBe(true);
  });

  it("mỗi phút / mỗi giờ theo khoảng cách từ lần chạy trước", () => {
    expect(isDue({ schedule: { everyMs: 60_000 } }, vn("10:00"), new Date(vn("10:00").getTime() + 59_000))).toBe(false);
    expect(isDue({ schedule: { everyMs: 60_000 } }, vn("10:00"), vn("10:01"))).toBe(true);
    expect(isDue({ schedule: { everyMs: 3_600_000 } }, vn("10:00"), vn("10:59"))).toBe(false);
    expect(isDue({ schedule: { everyMs: 3_600_000 } }, vn("10:00"), vn("11:00"))).toBe(true);
  });

  it("hằng ngày 21:00 giờ VN: 20:59 chưa, 21:00 có, chạy rồi thì 23:00 không, lên muộn 21:05 vẫn có", () => {
    const daily = { schedule: { dailyAt: "21:00" } };
    const yesterday = vn("21:00", "2026-10-30");
    expect(isDue(daily, yesterday, vn("20:59"))).toBe(false);
    expect(isDue(daily, yesterday, vn("21:00"))).toBe(true);
    expect(isDue(daily, yesterday, vn("21:05"))).toBe(true);
    expect(isDue(daily, vn("21:00"), vn("23:00"))).toBe(false);
    expect(isDue(daily, null, vn("20:59"))).toBe(false);
    expect(isDue(daily, null, vn("21:05"))).toBe(true);
  });

  it("qua nửa đêm giờ VN (17:00 UTC) vẫn tính đúng ngày", () => {
    const daily = { schedule: { dailyAt: "21:00" } };
    expect(isDue(daily, vn("21:00", "2026-10-31"), vn("00:30", "2026-11-01"))).toBe(false);
  });
});

describe("danh sách job", () => {
  it("đủ job với tên có namespace, lịch đúng", () => {
    expect(job("me.orders.expire").schedule).toEqual({ everyMs: 60_000 });
    expect(job("me.outbox.deliver").schedule).toEqual({ everyMs: 10_000 });
    expect(job("me.sessions.cleanup").schedule).toEqual({ everyMs: 3_600_000 });
    expect(job("me.admin.invites.expire").schedule).toEqual({ everyMs: 3_600_000 });
    expect(JOBS.every((j) => j.name.startsWith("me."))).toBe(true);
  });

  it("me.orders.expire đặt đơn quá hạn thành expired", async () => {
    const f = await moneyFixture();
    const pg = await pgAs("app");
    try {
      await pg.query("BEGIN");
      for (const [sql, params] of insertOrderSql(f)) await pg.query(sql, params);
      await pg.query("COMMIT");
    } finally {
      await pg.end();
    }
    await ageOrders(16 * 60_000);
    expect(await runJob(job("me.orders.expire"), "w1")).toMatchObject({ status: "success", stats: { expired: 1 } });
    expect((await prisma().order.findFirstOrThrow()).status).toBe("expired");
  });

  it("me.admin.invites.expire: lease mất thì không đổi gì; lease còn thì đổi đúng người quá hạn", async () => {
    const { rows: [invite] } = await sqlAsMigrator(
      `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at)
       VALUES ('moi@x.vn', 'support', 'invited', now() - interval '8 days', now() - interval '1 day') RETURNING id`,
    );
    const def = job("me.admin.invites.expire");
    const stale = (await acquireLease(def.name, "cu"))!;
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = $1`, [def.name]);
    await acquireLease(def.name, "moi");
    await expect(def.run({ lease: stale, signal: new AbortController().signal })).rejects.toBeInstanceOf(LeaseLostError);
    const status = async () => (await prisma().adminUser.findUniqueOrThrow({ where: { id: invite.id } })).status;
    expect(await status()).toBe("invited");
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = $1`, [def.name]);
    expect(await runJob(def, "w1")).toMatchObject({ status: "success", stats: { expired: 1 } });
    expect(await status()).toBe("expired");
  });

  it("me.sessions.cleanup và me.outbox.deliver chạy được trên DB trống", async () => {
    expect(await runJob(job("me.sessions.cleanup"), "w1")).toMatchObject({ status: "success" });
    expect(await runJob(job("me.outbox.deliver"), "w1")).toMatchObject({ status: "success", stats: { sent: 0 } });
  });
});
