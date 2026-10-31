import { prisma } from "@/lib/db";
import { isDue, type ScheduledJob } from "./definitions";
import { runJob, type RunResult } from "./runner";

export type LastRun = { lastAttempt: Date; lastCompleted: Date | null };

const DAILY_RETRY_MS = 5 * 60_000;

/** Lần thử và lần hoàn thành gần nhất của mỗi job. Skipped vì người khác đang giữ lease chưa tính là hoàn thành. */
export async function lastRuns(): Promise<Map<string, LastRun>> {
  const rows = await prisma().$queryRaw<{ job_name: string; last_attempt: Date; last_completed: Date | null }[]>`
    SELECT job_name, max(started_at) AS last_attempt,
           max(started_at) FILTER (WHERE status = 'success' OR stats ? 'skippedReason') AS last_completed
    FROM job_runs WHERE started_at > now() - interval '3 days' GROUP BY job_name`;
  return new Map(rows.map((r) => [r.job_name, { lastAttempt: r.last_attempt, lastCompleted: r.last_completed }]));
}

/** Job lặp tính theo lần thử gần nhất. Job hằng ngày tính theo lần hoàn thành để lỗi được thử lại, cách nhau 5 phút. */
export function dueJobs(jobs: ScheduledJob[], runs: Map<string, LastRun>, now: Date): ScheduledJob[] {
  return jobs.filter((job) => {
    const run = runs.get(job.name);
    if ("everyMs" in job.schedule) return isDue(job, run?.lastAttempt ?? null, now);
    if (run && now.getTime() - run.lastAttempt.getTime() < DAILY_RETRY_MS) return false;
    return isDue(job, run?.lastCompleted ?? null, now);
  });
}

type PendingRequest = { id: string; job_name: string };

/** Yêu cầu “chạy ngay” chưa xử lý, trừ job tiến trình này đang chạy (để lượt sau). */
function pendingRequests(exclude: string[]): Promise<PendingRequest[]> {
  return prisma().$queryRaw`
    SELECT id::text AS id, job_name FROM job_requests
    WHERE picked_at IS NULL AND job_name <> ALL(${exclude}::text[])
    ORDER BY requested_at`;
}

function markPicked(ids: string[], runId: string | null) {
  return prisma().jobRequest.updateMany({ where: { id: { in: ids }, pickedAt: null }, data: { pickedAt: new Date(), runId } });
}

/** Yêu cầu chỉ được tính là xong khi job thật sự chạy: lease đang bị giữ hay worker tắt giữa chừng thì giữ lại để lượt sau chạy. */
function consumesRequest(result: RunResult): boolean {
  if (result.status === "skipped") return result.stats !== undefined;
  return !(result.status === "failed" && result.error === "shutdown");
}

/** Mỗi job chạy song song độc lập để job đối soát dài không làm trễ việc gửi thông báo; một job không chạy chồng trong tiến trình. */
export function createScheduler(jobs: ScheduledJob[], holder: string, opts: { signal?: AbortSignal } = {}) {
  const inflight = new Map<string, Promise<void>>();
  let ticking: Promise<void> | null = null;

  function start(job: ScheduledJob, requestIds: string[] = []) {
    if (inflight.has(job.name)) return;
    const task = runJob(job, holder, { signal: opts.signal })
      .then(async (result) => {
        if (requestIds.length > 0 && consumesRequest(result)) await markPicked(requestIds, result.runId);
      })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ at: "worker", job: job.name, error: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => inflight.delete(job.name));
    inflight.set(job.name, task);
  }

  async function runTick(): Promise<void> {
    const requests = await pendingRequests([...inflight.keys()]);
    const known = new Set(jobs.map((job) => job.name));
    const orphaned = requests.filter((r) => !known.has(r.job_name)).map((r) => r.id);
    if (orphaned.length > 0) await markPicked(orphaned, null);
    for (const job of jobs) {
      const ids = requests.filter((r) => r.job_name === job.name).map((r) => r.id);
      if (ids.length > 0) start(job, ids);
    }
    const free = jobs.filter((job) => !inflight.has(job.name));
    for (const job of dueJobs(free, await lastRuns(), new Date())) start(job);
  }

  return {
    /** Lượt đang chạy dở thì dùng chung lượt đó, không chạy chồng. */
    tick(): Promise<void> {
      ticking ??= runTick().finally(() => {
        ticking = null;
      });
      return ticking;
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inflight.values()]);
    },
  };
}
