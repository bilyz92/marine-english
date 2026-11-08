import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { createModule, listModules, MODULE_TITLE_MAX } from "@/modules/content/modules";
import { requireAdmin } from "@/modules/sessions/guards";

// Module của khóa (docs/superpowers/plans/2026-11-08-course-modules.md).
const Body = z.object({ titleVi: z.string().max(MODULE_TITLE_MAX * 2) });

export const GET = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireAdmin(req);
  return json(await listModules(ctx, (await params).slug));
});

export const POST = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireAdmin(req);
  const body = await readJson(req, Body);
  return json(await createModule(ctx, (await params).slug, body.titleVi));
});
