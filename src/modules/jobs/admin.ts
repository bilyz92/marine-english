import { prisma, withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { JOBS } from "./definitions";

/** Mọi job kèm lần chạy gần nhất và lease đang giữ. */
export async function listJobs(ctx: AdminCtx) {
  await authorize(ctx, "jobs.run", { action: "jobs_view" });
  const leases = await prisma().jobLease.findMany({ where: { expiresAt: { gt: new Date() } } });
  return Promise.all(
    JOBS.map(async (job) => {
      const run = await prisma().jobRun.findFirst({ where: { jobName: job.name }, orderBy: { startedAt: "desc" } });
      const lease = leases.find((l) => l.jobName === job.name);
      return {
        name: job.name,
        schedule: job.schedule,
        lastRun: run && { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error, stats: run.stats },
        lease: lease ? { holder: lease.holder, expiresAt: lease.expiresAt } : null,
      };
    }),
  );
}

/** “Chạy ngay” chỉ ghi yêu cầu; worker nhận và chạy dưới lease như mọi lần chạy khác. */
export async function requestRun(ctx: AdminCtx, jobName: string): Promise<void> {
  await authorize(ctx, "jobs.run", { action: "job_run_request", resource: { type: "job", id: jobName } });
  if (!JOBS.some((job) => job.name === jobName)) throw new HttpError(400, "Không có job này");
  await withTx(async (tx) => {
    await tx.jobRequest.create({ data: { jobName, requestedBy: ctx.adminId } });
    await audit(tx, { adminId: ctx.adminId, action: "job_run_request", targetType: "job", targetId: jobName, result: "ok", ip: ctx.ip });
  });
}
