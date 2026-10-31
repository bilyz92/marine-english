import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET, POST } from "@/app/api/quan-tri/jobs/route";
import { JOBS } from "@/modules/jobs/definitions";
import { acquireLease } from "@/modules/jobs/lease";
import { runJob, type JobDef } from "@/modules/jobs/runner";
import { createScheduler, dueJobs, lastRuns } from "@/modules/jobs/scheduler";
import { auditRows } from "../helpers/admin";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";

const PATH = "/api/quan-tri/jobs";
const vn = (time: string, day = "2026-10-31") => new Date(`${day}T${time}:00+07:00`);

describe("API quản trị job", () => {
  it("owner yêu cầu chạy → dòng job_requests + audit; không có endpoint chạy trực tiếp", async () => {
    const owner = await adminSess("owner");
    const res = await callAdmin(POST, owner, "POST", PATH, { job: "me.orders.expire" });
    expect(res.status).toBe(202);
    const rows = await prisma().jobRequest.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobName: "me.orders.expire", requestedBy: owner.adminId, pickedAt: null, runId: null });
    expect(await prisma().jobRun.count()).toBe(0);
    expect((await auditRows()).some((a: { action: string; result: string }) => a.action === "job_run_request" && a.result === "ok")).toBe(true);
  });

  it("support → 403 + audit denied, không tạo yêu cầu", async () => {
    const support = await adminSess("support");
    const res = await callAdmin(POST, support, "POST", PATH, { job: "me.orders.expire" });
    expect(res.status).toBe(403);
    expect(await prisma().jobRequest.count()).toBe(0);
    expect((await auditRows()).some((a: { action: string; result: string }) => a.action === "job_run_request" && a.result === "denied")).toBe(true);
  });

  it("job lạ → 400", async () => {
    const owner = await adminSess("owner");
    expect((await callAdmin(POST, owner, "POST", PATH, { job: "me.khong.co" })).status).toBe(400);
    expect(await prisma().jobRequest.count()).toBe(0);
  });

  it("GET trả mọi job kèm lần chạy gần nhất và lease", async () => {
    const owner = await adminSess("owner");
    await runJob(JOBS.find((j) => j.name === "me.orders.expire")!, "w1");
    const res = await callAdmin(GET, owner, "GET", PATH);
    expect(res.status).toBe(200);
    const { jobs } = (await res.json()) as { jobs: { name: string; lastRun: { status: string } | null }[] };
    expect(jobs.map((j) => j.name).sort()).toEqual(JOBS.map((j) => j.name).sort());
    expect(jobs.find((j) => j.name === "me.orders.expire")!.lastRun).toMatchObject({ status: "success" });
    expect(jobs.find((j) => j.name === "me.sessions.cleanup")!.lastRun).toBeNull();
  });
});

describe("lịch của worker", () => {
  const every = { name: "me.a", timeoutMs: 1000, schedule: { everyMs: 60_000 }, run: async () => ({}) };
  const daily = { name: "me.b", timeoutMs: 1000, schedule: { dailyAt: "21:00" }, run: async () => ({}) };

  it("job hằng ngày lỗi được thử lại sau 5 phút, không phải ngày mai; thành công rồi thì thôi", () => {
    const names = (runs: Parameters<typeof dueJobs>[1], now: Date) => dueJobs([daily], runs, now).map((j) => j.name);
    const failedAt2100 = new Map([["me.b", { lastAttempt: vn("21:00"), lastCompleted: vn("21:00", "2026-10-30") }]]);
    expect(names(failedAt2100, vn("21:04"))).toEqual([]);
    expect(names(failedAt2100, vn("21:05"))).toEqual(["me.b"]);
    const okAt2100 = new Map([["me.b", { lastAttempt: vn("21:00"), lastCompleted: vn("21:00") }]]);
    expect(names(okAt2100, vn("22:00"))).toEqual([]);
  });

  it("job lặp lỗi không chạy dồn: tính theo lần thử gần nhất", () => {
    const runs = new Map([["me.a", { lastAttempt: vn("10:00"), lastCompleted: null }]]);
    expect(dueJobs([every], runs, vn("10:00"))).toEqual([]);
    expect(dueJobs([every], runs, vn("10:01")).map((j) => j.name)).toEqual(["me.a"]);
  });

  it("lastRuns: skipped vì đang có người giữ không tính là hoàn thành; skipped vì chưa cấu hình thì có", async () => {
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status) VALUES ('me.x', 'skipped')`);
    await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, stats) VALUES ('me.y', 'skipped', '{"skippedReason":"not_configured"}')`);
    const runs = await lastRuns();
    expect(runs.get("me.x")!.lastCompleted).toBeNull();
    expect(runs.get("me.y")!.lastCompleted).not.toBeNull();
  });
});

describe("worker tick", () => {
  function blocking(name: string) {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let runs = 0;
    const def: JobDef & { schedule: { everyMs: number } } = {
      name, timeoutMs: 5000, schedule: { everyMs: 1 },
      run: async () => {
        runs++;
        await gate;
        return {};
      },
    };
    return { def, release, runs: () => runs };
  }

  it("job đang chạy thì tick sau không chạy chồng; xong thì ghi success", async () => {
    const b = blocking("me.block");
    const s = createScheduler([b.def], "w1");
    await s.tick();
    await s.tick();
    await new Promise((r) => setTimeout(r, 100));
    expect(b.runs()).toBe(1);
    b.release();
    await s.drain();
    expect(await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.block" } })).toMatchObject({ status: "success" });
  });

  it("“chạy ngay” chạy job dù chưa đến hạn và nối yêu cầu với lần chạy", async () => {
    const owner = await adminSess("owner");
    const def = { name: "me.orders.expire", timeoutMs: 5000, schedule: { everyMs: 3_600_000 }, run: async () => ({ ok: 1 }) };
    await runJob(def, "w1"); // vừa chạy nên chưa đến hạn
    await callAdmin(POST, owner, "POST", PATH, { job: "me.orders.expire" });
    const s = createScheduler([def], "w1");
    await s.tick();
    await s.drain();
    const request = await prisma().jobRequest.findFirstOrThrow();
    expect(request.pickedAt).not.toBeNull();
    expect(request.runId).not.toBeNull();
    expect(await prisma().jobRun.count({ where: { jobName: def.name } })).toBe(2);
  });

  it("hai tick chồng nhau → job chỉ chạy một lần, không ghi skipped", async () => {
    const b = blocking("me.overlap");
    const s = createScheduler([b.def], "w1");
    await Promise.all([s.tick(), s.tick()]);
    await new Promise((r) => setTimeout(r, 100));
    expect(b.runs()).toBe(1);
    b.release();
    await s.drain();
    expect(await prisma().jobRun.count({ where: { jobName: "me.overlap" } })).toBe(1);
  });

  it("yêu cầu chỉ được đánh dấu khi job thật sự chạy: worker khác giữ lease → giữ lại, lần sau chạy", async () => {
    const owner = await adminSess("owner");
    const def = { name: "me.orders.expire", timeoutMs: 5000, schedule: { everyMs: 3_600_000 }, run: async () => ({ ok: 1 }) };
    await callAdmin(POST, owner, "POST", PATH, { job: def.name });
    await acquireLease(def.name, "worker-khac");
    const s = createScheduler([def], "w1");
    await s.tick();
    await s.drain();
    expect(await prisma().jobRequest.findFirstOrThrow()).toMatchObject({ pickedAt: null, runId: null });
    await sqlAsMigrator(`UPDATE job_leases SET expires_at = now() - interval '1 second'`);
    await s.tick();
    await s.drain();
    const request = await prisma().jobRequest.findFirstOrThrow();
    expect(request.pickedAt).not.toBeNull();
    const run = await prisma().jobRun.findUniqueOrThrow({ where: { id: request.runId! } });
    expect(run.status).toBe("success");
  });

  it("job đang chạy mà worker chết: yêu cầu chưa bị tiêu, khởi động lại sẽ chạy", async () => {
    const owner = await adminSess("owner");
    const b = blocking("me.orders.expire");
    await callAdmin(POST, owner, "POST", PATH, { job: b.def.name });
    const s = createScheduler([b.def], "w1");
    await s.tick();
    await new Promise((r) => setTimeout(r, 100));
    expect((await prisma().jobRequest.findFirstOrThrow()).pickedAt).toBeNull();
    b.release();
    await s.drain();
    expect((await prisma().jobRequest.findFirstOrThrow()).pickedAt).not.toBeNull();
  });

  it("tắt worker giữa chừng: yêu cầu giữ lại để chạy lại", async () => {
    const owner = await adminSess("owner");
    const controller = new AbortController();
    const def = { name: "me.orders.expire", timeoutMs: 60_000, schedule: { everyMs: 3_600_000 }, run: ({ signal }: { signal: AbortSignal }) => new Promise<object>((resolve) => signal.addEventListener("abort", () => resolve({}))) };
    await callAdmin(POST, owner, "POST", PATH, { job: def.name });
    const s = createScheduler([def as never], "w1", { signal: controller.signal });
    await s.tick();
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await s.drain();
    expect((await prisma().jobRequest.findFirstOrThrow()).pickedAt).toBeNull();
  });

  it("dừng khi lượt tick còn dở → không khởi động job mới; drain chờ cả lượt đó; tick sau không làm gì", async () => {
    const b = blocking("me.stop");
    b.release();
    const s = createScheduler([b.def], "w1");
    const tick = s.tick();
    s.stop();
    await s.drain();
    expect(b.runs()).toBe(0);
    await tick;
    await s.tick();
    await s.drain();
    expect(b.runs()).toBe(0);
    expect(await prisma().jobRun.count({ where: { jobName: "me.stop" } })).toBe(0);
  });

  it("runJob với tín hiệu đã hủy sẵn → không gọi job, ghi shutdown, nhả lease", async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const def = { name: "me.pre", timeoutMs: 5000, run: async () => { called = true; return {}; } };
    expect(await runJob(def, "w1", { signal: controller.signal })).toMatchObject({ status: "failed", error: "shutdown" });
    expect(called).toBe(false);
    expect((await prisma().jobLease.findUniqueOrThrow({ where: { jobName: "me.pre" } })).expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("yêu cầu cho job đã bỏ khỏi danh sách → đánh dấu đã nhận, không kẹt", async () => {
    const owner = await adminSess("owner");
    await callAdmin(POST, owner, "POST", PATH, { job: "me.orders.expire" });
    const s = createScheduler([], "w1");
    await s.tick();
    expect((await prisma().jobRequest.findFirstOrThrow()).pickedAt).not.toBeNull();
  });

  it("tắt worker khi job còn chạy → hủy, ghi failed shutdown, nhả lease, không cảnh báo", async () => {
    const controller = new AbortController();
    const def = { name: "me.long", timeoutMs: 60_000, schedule: { everyMs: 1 }, run: ({ signal }: { signal: AbortSignal }) => new Promise<object>((resolve) => signal.addEventListener("abort", () => resolve({}))) };
    const s = createScheduler([def as never], "w1", { signal: controller.signal });
    await s.tick();
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await s.drain();
    expect(await prisma().jobRun.findFirstOrThrow({ where: { jobName: "me.long" } })).toMatchObject({ status: "failed", error: "shutdown" });
    expect(await prisma().outboxEvent.count({ where: { kind: "job_failed" } })).toBe(0);
    expect((await prisma().jobLease.findUniqueOrThrow({ where: { jobName: "me.long" } })).expiresAt.getTime()).toBeLessThan(Date.now());
  });

  it("me.jobs.prune xóa nhật ký quá 30 ngày, giữ dòng mới và dòng có yêu cầu trỏ tới", async () => {
    const owner = await adminSess("owner");
    const { rows: [old] } = await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, started_at) VALUES ('me.c', 'success', now() - interval '31 days') RETURNING id`);
    const { rows: [linked] } = await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, started_at) VALUES ('me.c', 'success', now() - interval '40 days') RETURNING id`);
    const { rows: [recent] } = await sqlAsMigrator(`INSERT INTO job_runs (job_name, status, started_at) VALUES ('me.c', 'success', now() - interval '29 days') RETURNING id`);
    await sqlAsMigrator(`INSERT INTO job_requests (job_name, requested_by, run_id, picked_at) VALUES ('me.c', $1, $2, now())`, [owner.adminId, linked.id]);
    const prune = JOBS.find((j) => j.name === "me.jobs.prune")!;
    expect(prune.schedule).toEqual({ dailyAt: "04:00" });
    expect(await runJob(prune, "w1")).toMatchObject({ status: "success", stats: { deleted: 1 } });
    const left = (await prisma().jobRun.findMany({ where: { jobName: "me.c" } })).map((r) => r.id);
    expect(left).not.toContain(old.id);
    expect(left.sort()).toEqual([linked.id, recent.id].sort());
  });
});
