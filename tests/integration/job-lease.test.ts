import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { acquireLease, heartbeat, LeaseLostError, releaseLease, withFence } from "@/modules/jobs/lease";
import { runJob, type JobDef } from "@/modules/jobs/runner";
import { sqlAsMigrator } from "../helpers/otp";

const expireLease = (job: string) => sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = $1`, [job]);

describe("lease", () => {
  it("hai bên lấy song song → một lease; hết hạn → bên khác lấy được, generation tăng", async () => {
    const results = await Promise.all([acquireLease("me.test", "w1"), acquireLease("me.test", "w2")]);
    const won = results.filter((r) => r !== null);
    expect(won).toHaveLength(1);
    expect(won[0]!.generation).toBe(BigInt(1));
    expect(await acquireLease("me.test", "w3")).toBeNull();
    await expireLease("me.test");
    const next = await acquireLease("me.test", "w3");
    expect(next!.generation).toBe(BigInt(2));
    expect(await heartbeat(won[0]!)).toBe(false);
    expect(await heartbeat(next!)).toBe(true);
    await releaseLease(next!);
    expect(await acquireLease("me.test", "w4")).not.toBeNull();
  });

  it("withFence: lease còn hiệu lực thì ghi được; lease cũ (đã bị lấy lại) → LeaseLostError, không ghi gì", async () => {
    const old = (await acquireLease("me.fence", "w1"))!;
    await withFence(old, (tx) => tx.$executeRaw`INSERT INTO job_runs (job_name, status) VALUES ('me.fence', 'success')`);
    await expireLease("me.fence");
    await acquireLease("me.fence", "w2");
    await expect(withFence(old, (tx) => tx.$executeRaw`INSERT INTO job_runs (job_name, status) VALUES ('me.fence', 'success')`)).rejects.toBeInstanceOf(LeaseLostError);
    expect(await prisma().jobRun.count({ where: { jobName: "me.fence" } })).toBe(1);
  });
});

describe("runJob", () => {
  const job = (name: string, run: JobDef["run"], timeoutMs = 5_000): JobDef => ({ name, timeoutMs, run });

  it("chạy xong → success với thống kê; đang có người giữ → skipped", async () => {
    expect(await runJob(job("me.ok", async () => ({ done: 3 })), "w1")).toMatchObject({ status: "success" });
    const run = await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.ok" } });
    expect(run).toMatchObject({ status: "success", stats: { done: 3 }, generation: BigInt(1) });
    expect(run.finishedAt).not.toBeNull();
    await acquireLease("me.busy", "khac");
    expect(await runJob(job("me.busy", async () => ({})), "w1")).toMatchObject({ status: "skipped" });
    expect((await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.busy" } })).status).toBe("skipped");
  });

  it("lỗi → failed + một cảnh báo outbox cho nhóm lỗi (không lặp trong cùng giờ); nhả lease", async () => {
    const boom = job("me.boom", async () => {
      throw new Error("hỏng DB");
    });
    expect(await runJob(boom, "w1")).toMatchObject({ status: "failed", error: "hỏng DB" });
    await runJob(boom, "w1");
    const alerts = await prisma().outboxEvent.findMany({ where: { kind: "job_failed" } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ channel: "telegram", payload: { job: "me.boom", status: "failed", error: "hỏng DB" } });
    expect(await acquireLease("me.boom", "w2")).not.toBeNull();
  });

  it("quá thời gian → timeout, tín hiệu hủy được gửi cho job", async () => {
    let aborted = false;
    const slow = job("me.slow", ({ signal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { aborted = true; resolve({}); });
    }), 200);
    expect(await runJob(slow, "w1")).toMatchObject({ status: "timeout" });
    expect(aborted).toBe(true);
  });

  it("mất lease giữa chừng (heartbeat thất bại) → job bị hủy, ghi failed lease_lost", async () => {
    const lost = job("me.lost", ({ signal }) => new Promise((resolve) => {
      void sqlAsMigrator(`UPDATE job_leases SET token = gen_random_uuid() WHERE job_name = 'me.lost'`);
      signal.addEventListener("abort", () => resolve({}));
    }), 10_000);
    expect(await runJob(lost, "w1", { heartbeatMs: 100 })).toMatchObject({ status: "failed", error: "lease_lost" });
  });
});
