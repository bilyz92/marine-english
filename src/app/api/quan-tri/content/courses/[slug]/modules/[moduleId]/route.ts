import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { deleteModule, MODULE_TITLE_MAX, moveModule, renameModule } from "@/modules/content/modules";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.union([z.object({ titleVi: z.string().max(MODULE_TITLE_MAX * 2) }), z.object({ move: z.enum(["up", "down"]) })]);
type Params = { params: Promise<{ slug: string; moduleId: string }> };

export const PATCH = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, moduleId } = await params;
  const body = await readJson(req, Body);
  if ("move" in body) await moveModule(ctx, slug, z.uuid().parse(moduleId), body.move);
  else await renameModule(ctx, slug, z.uuid().parse(moduleId), body.titleVi);
  return json({ ok: true });
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, moduleId } = await params;
  await deleteModule(ctx, slug, z.uuid().parse(moduleId));
  return json({ ok: true });
});
