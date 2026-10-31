import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as workerHealth } from "@/app/api/health/worker/route";
import { acquireLease } from "@/modules/jobs/lease";
import { runJob, type JobDef } from "@/modules/jobs/runner";
import { abandonStaleRuns, enqueueAlerts, watch, type WatchDeps } from "@/modules/ops/watch";
import { classifyPath } from "@/modules/sessions/routes";
import { sqlAsMigrator } from "../helpers/otp";

const NOW = new Date("2026-10-31T10:00:00Z"); // 17:00 giờ VN
const healthy: WatchDeps = { diskUsage: async () => 0.4, appHealthy: async () => true, certDaysLeft: async () => 60 };
const types = async (deps: Partial<WatchDeps> = {}, now = NOW) => (await watch(now, { ...healthy, ...deps })).map((a) => a.type).sort();
const runAt = (job: string, status: string, at: Date, stats: object | null = null) =>
  sqlAsMigrator(`INSERT INTO job_runs (job_name, status, started_at, finished_at, stats) VALUES ($1, $2, $3, $3, $4)`, [job, status, at, stats && JSON.stringify(stats)]);
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("điều kiện cảnh báo", () => {
  it("không có gì bất thường → không cảnh báo", async () => {
    await runAt("me.backup.daily", "success", ago(10 * HOUR));
    expect(await types()).toEqual([]);
  });

  it("ổ đĩa 70% và 85%", async () => {
    expect(await types({ diskUsage: async () => 0.72 })).toEqual(["disk_70"]);
    expect(await types({ diskUsage: async () => 0.9 })).toEqual(["disk_85"]);
  });

  it("app không trả lời; chứng chỉ còn dưới 14 ngày; không đo được chứng chỉ thì bỏ qua", async () => {
    expect(await types({ appHealthy: async () => false })).toEqual(["app_down"]);
    expect(await types({ certDaysLeft: async () => 10 })).toEqual(["cert_expiring"]);
    expect(await types({ certDaysLeft: async () => null })).toEqual([]);
  });

  it("sao lưu thành công gần nhất quá 26 giờ; chạy rồi mà chưa thành công lần nào thì tính từ lần đầu", async () => {
    await runAt("me.backup.daily", "success", ago(27 * HOUR));
    expect(await types()).toEqual(["backup_stale"]);
    await sqlAsMigrator(`DELETE FROM job_runs`);
    await runAt("me.backup.daily", "failed", ago(30 * HOUR));
    await runAt("me.backup.daily", "failed", ago(2 * HOUR));
    expect(await types()).toEqual(["backup_stale"]);
    await sqlAsMigrator(`DELETE FROM job_runs`);
    await runAt("me.backup.daily", "failed", ago(2 * HOUR));
    expect(await types()).toEqual([]);
  });

  it("sao lưu chưa cấu hình (skipped) đã có cảnh báo riêng → không báo thêm", async () => {
    await runAt("me.backup.daily", "skipped", ago(30 * HOUR), { skippedReason: "not_configured" });
    await runAt("me.backup.daily", "skipped", ago(1 * HOUR), { skippedReason: "not_configured" });
    expect(await types()).toEqual([]);
  });

  it("job lặp không hoàn thành trong 3 chu kỳ; skipped vì chưa cấu hình tính là hoàn thành; chưa từng chạy thì không báo", async () => {
    await runAt("me.orders.expire", "success", ago(7 * MIN));
    await runAt("me.orders.expire", "failed", ago(30_000));
    expect(await types()).toEqual(["job_stuck:me.orders.expire"]);
    await runAt("me.sepay.reconcile", "skipped", ago(30 * MIN), { skippedReason: "not_configured" });
    expect(await types()).toEqual(["job_stuck:me.orders.expire"]);
  });

  it("job hằng ngày đã chạy trước đây mà lỡ lịch quá 1 giờ", async () => {
    // 21:00 VN hôm qua có chạy; bây giờ 17:00 VN chưa tới giờ hôm nay → không báo.
    await runAt("me.summary.daily", "success", new Date("2026-10-30T14:00:00Z"));
    expect(await types()).toEqual([]);
    // 22:30 VN hôm nay mà vẫn chưa chạy → báo.
    expect(await types({}, new Date("2026-10-31T15:30:00Z"))).toEqual(["job_missed:me.summary.daily"]);
  });

  it("outbox chờ quá 30 phút (trừ chưa cấu hình) hoặc có tin chết", async () => {
    await sqlAsMigrator(`INSERT INTO outbox_events (dedup_key, kind, channel, payload, created_at, last_error) VALUES ('a', 'order_paid', 'telegram', '{}', $1, 'not_configured')`, [ago(2 * HOUR)]);
    expect(await types()).toEqual([]);
    // Lỗi lặp lại: lần thử sau luôn ở tương lai, nhưng tin đã chờ từ 31 phút trước.
    await sqlAsMigrator(`INSERT INTO outbox_events (dedup_key, kind, channel, payload, created_at, next_attempt_at, last_error) VALUES ('b', 'order_paid', 'telegram', '{}', $1, $2, 'mất mạng')`, [ago(31 * MIN), new Date(NOW.getTime() + 10 * MIN)]);
    expect(await types()).toEqual(["outbox_stuck"]);
    await sqlAsMigrator(`INSERT INTO outbox_events (dedup_key, kind, channel, payload, status) VALUES ('c', 'order_paid', 'email', '{}', 'dead')`);
    expect(await types()).toEqual(["outbox_dead", "outbox_stuck"]);
  });

  it("tin cảnh báo chết không tự sinh cảnh báo mới (token Telegram bị thu hồi)", async () => {
    await sqlAsMigrator(`INSERT INTO outbox_events (dedup_key, kind, channel, payload, status) VALUES ('d1', 'ops_alert', 'telegram', '{}', 'dead'), ('d2', 'outbox_dead', 'telegram', '{}', 'dead'), ('d3', 'backup_alert', 'telegram', '{}', 'dead')`);
    expect(await types()).toEqual([]);
  });

  it("gửi thông báo chậm (một lượt tới 2 phút) không bị báo kẹt", async () => {
    await runAt("me.outbox.deliver", "success", ago(2 * MIN));
    expect(await types()).toEqual([]);
    await runAt("me.outbox.deliver", "failed", ago(30_000));
    await sqlAsMigrator(`DELETE FROM job_runs WHERE status = 'success'`);
    await runAt("me.outbox.deliver", "success", ago(10 * MIN));
    expect(await types()).toEqual(["job_stuck:me.outbox.deliver"]);
  });

  it("mỗi điều kiện một cảnh báo trong một giờ", async () => {
    const alerts = await watch(NOW, { ...healthy, diskUsage: async () => 0.9 });
    await enqueueAlerts(alerts, NOW);
    await enqueueAlerts(alerts, new Date(NOW.getTime() + 20 * MIN));
    await enqueueAlerts(alerts, new Date(NOW.getTime() + 70 * MIN));
    const rows = await prisma().outboxEvent.findMany({ where: { kind: "ops_alert" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ channel: "telegram", payload: { type: "disk_85" } });
  });
});

describe("lần chạy bị bỏ dở", () => {
  it("running mà lease đã hết hạn hoặc khác generation → failed abandoned; đang giữ lease thì không đụng", async () => {
    const live = (await acquireLease("me.live", "w1"))!;
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, generation) VALUES ('me.live', 'running', $1)`, [live.generation]);
    await acquireLease("me.dead", "w1");
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = 'me.dead'`);
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, generation) VALUES ('me.dead', 'running', 1)`);
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, generation) VALUES ('me.live', 'running', 99)`);
    expect(await abandonStaleRuns()).toBe(2);
    const rows = await prisma().jobRun.findMany({ orderBy: { jobName: "asc" } });
    expect(rows.map((r) => [r.jobName, String(r.generation), r.status, r.error])).toEqual(expect.arrayContaining([
      ["me.live", String(live.generation), "running", null], ["me.dead", "1", "failed", "abandoned"], ["me.live", "99", "failed", "abandoned"],
    ]));
  });

  it("runner kết thúc sau khi bị đánh abandoned → không ghi đè", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const def: JobDef = { name: "me.race", timeoutMs: 5000, run: async () => { await gate; return { ok: 1 }; } };
    const running = runJob(def, "w1");
    await new Promise((r) => setTimeout(r, 200));
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second' WHERE job_name = 'me.race'`);
    expect(await abandonStaleRuns()).toBe(1);
    release();
    await running;
    expect(await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.race" } })).toMatchObject({ status: "failed", error: "abandoned" });
  });

  it("runner ghi xong trước → abandoned không đụng", async () => {
    await runJob({ name: "me.done", timeoutMs: 5000, run: async () => ({}) }, "w1");
    expect(await abandonStaleRuns()).toBe(0);
    expect((await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.done" } })).status).toBe("success");
  });
});

describe("/api/health/worker", () => {
  const call = async () => {
    const res = await workerHealth(new Request("http://x/api/health/worker"));
    return { status: res.status, body: (await res.json()) as { ok: boolean; reason?: string } };
  };

  it("công khai như /api/health", () => {
    expect(classifyPath("/api/health/worker")).toBe("public");
  });

  it("có lần gửi outbox trong 2 phút → 200; không có → 503", async () => {
    expect(await call()).toMatchObject({ status: 503, body: { ok: false, reason: "worker_silent" } });
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status) VALUES ('me.outbox.deliver', 'success')`);
    expect(await call()).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("production thiếu kênh cảnh báo Telegram → 503 alerts_not_configured", async () => {
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status) VALUES ('me.outbox.deliver', 'success')`);
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(await call()).toMatchObject({ status: 503, body: { reason: "alerts_not_configured" } });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("job giám sát", () => {
  it("mỗi 5 phút", async () => {
    const { JOBS } = await import("@/modules/jobs/definitions");
    expect(JOBS.find((j) => j.name === "me.ops.watch")!.schedule).toEqual({ everyMs: 5 * MIN });
  });
});
