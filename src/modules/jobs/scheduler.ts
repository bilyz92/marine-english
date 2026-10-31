import { prisma } from "@/lib/db";
import { isDue, type ScheduledJob } from "./definitions";
import { runJob } from "./runner";

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

/** Nhận các yêu cầu “chạy ngay”, trừ job tiến trình này đang chạy (để lượt sau). */
async function pickRequests(exclude: string[]): Promise<{ id: string; job_name: string }[]> {
  return prisma().$queryRaw`
    WITH picked AS MATERIALIZED (
      SELECT id FROM job_requests
      WHERE picked_at IS NULL AND job_name <> ALL(${exclude}::text[])
      ORDER BY requested_at
      FOR UPDATE SKIP LOCKED
    )
    UPDATE job_requests r SET picked_at = now() FROM picked WHERE r.id = picked.id
    RETURNING r.id::text AS id, r.job_name`;
}

/** Mỗi job chạy song song độc lập để job đối soát dài không làm trễ việc gửi thông báo; một job không chạy chồng trong tiến trình. */
export function createScheduler(jobs: ScheduledJob[], holder: string, opts: { signal?: AbortSignal } = {}) {
  const inflight = new Map<string, Promise<void>>();

  function start(job: ScheduledJob, requestIds: string[] = []) {
    const task = runJob(job, holder, { signal: opts.signal })
      .then(async (result) => {
        if (requestIds.length === 0) return;
        await prisma().jobRequest.updateMany({ where: { id: { in: requestIds } }, data: { runId: result.runId } });
      })
      .catch((error: unknown) => {
        console.error(JSON.stringify({ at: "worker", job: job.name, error: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => inflight.delete(job.name));
    inflight.set(job.name, task);
  }

  return {
    async tick(): Promise<void> {
      const requests = await pickRequests([...inflight.keys()]);
      for (const job of jobs) {
        const ids = requests.filter((r) => r.job_name === job.name).map((r) => r.id);
        if (ids.length > 0) start(job, ids);
      }
      const free = jobs.filter((job) => !inflight.has(job.name));
      for (const job of dueJobs(free, await lastRuns(), new Date())) start(job);
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...inflight.values()]);
    },
  };
}
