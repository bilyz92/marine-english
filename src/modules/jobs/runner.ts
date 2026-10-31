import { prisma, withTx } from "@/lib/db";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import { acquireLease, heartbeat, releaseLease, type Lease } from "./lease";

export type JobStats = Record<string, unknown>;
export type JobDef = {
  name: string;
  timeoutMs: number;
  run(ctx: { lease: Lease; signal: AbortSignal }): Promise<JobStats>;
};
export type RunResult =
  | { status: "success"; runId: string; stats: JobStats }
  | { status: "skipped"; runId: string }
  | { status: "failed" | "timeout"; runId: string; error: string };

const HEARTBEAT_MS = 30_000;

/**
 * Chạy một job dưới lease: ghi job_runs, gia hạn lease định kỳ, hủy job khi mất lease hoặc quá giờ.
 * Lỗi/quá giờ gửi một cảnh báo Telegram cho nhóm lỗi (mỗi job tối đa một cảnh báo mỗi giờ).
 */
export async function runJob(def: JobDef, holder: string, opts: { heartbeatMs?: number } = {}): Promise<RunResult> {
  const lease = await acquireLease(def.name, holder);
  if (!lease) {
    const run = await prisma().jobRun.create({ data: { jobName: def.name, status: "skipped", finishedAt: new Date() } });
    return { status: "skipped", runId: run.id };
  }
  const run = await prisma().jobRun.create({ data: { jobName: def.name, status: "running", generation: lease.generation } });
  const controller = new AbortController();
  let stop: (reason: "timeout" | "lease_lost") => void = () => {};
  const stopped = new Promise<"timeout" | "lease_lost">((resolve) => (stop = resolve));
  const abort = (reason: "timeout" | "lease_lost") => {
    if (controller.signal.aborted) return;
    controller.abort(reason);
    stop(reason);
  };
  const timer = setTimeout(() => abort("timeout"), def.timeoutMs);
  const beat = setInterval(() => {
    void heartbeat(lease).then((ok) => ok || abort("lease_lost"), () => abort("lease_lost"));
  }, opts.heartbeatMs ?? HEARTBEAT_MS);

  let result: RunResult;
  try {
    const work = def.run({ lease, signal: controller.signal });
    work.catch(() => {}); // job bị bỏ giữa chừng vẫn có thể ném sau đó; ghi của nó đã bị chặn bằng fence
    const raced = await Promise.race([work.then((stats) => ({ stats })), stopped.then((reason) => ({ reason }))]);
    // Job trả về sau khi đã bị hủy thì vẫn tính theo lý do hủy, không phải xong.
    const outcome = controller.signal.aborted ? { reason: controller.signal.reason as "timeout" | "lease_lost" } : raced;
    if ("stats" in outcome) result = { status: "success", runId: run.id, stats: outcome.stats };
    else if (outcome.reason === "timeout") result = { status: "timeout", runId: run.id, error: "timeout" };
    else result = { status: "failed", runId: run.id, error: "lease_lost" };
  } catch (error) {
    result = { status: "failed", runId: run.id, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    clearInterval(beat);
  }

  const failure = result.status === "failed" || result.status === "timeout" ? result : null;
  await withTx(async (tx) => {
    await tx.jobRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        finishedAt: new Date(),
        error: failure?.error ?? null,
        stats: result.status === "success" ? (result.stats as object) : undefined,
      },
    });
    if (failure) {
      const hour = new Date().toISOString().slice(0, 13);
      await enqueueOutbox(tx, {
        dedupKey: `job_failed:${def.name}:${hour}`,
        kind: "job_failed",
        channel: "telegram",
        payload: { job: def.name, status: failure.status, error: failure.error, runId: run.id },
      });
    }
  });
  if (failure?.error !== "lease_lost") await releaseLease(lease);
  return result;
}
