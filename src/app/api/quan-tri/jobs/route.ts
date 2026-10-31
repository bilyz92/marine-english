import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { listJobs, requestRun } from "@/modules/jobs/admin";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  return json({ jobs: await listJobs(ctx) });
});

const Body = z.object({ job: z.string().min(1).max(100) });

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const { job } = await readJson(req, Body);
  await requestRun(ctx, job);
  return json({ requested: true }, { status: 202 });
});
