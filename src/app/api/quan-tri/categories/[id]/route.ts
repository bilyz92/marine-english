import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { CATEGORY_TITLE_MAX, deleteCategory, moveCategory, updateCategory } from "@/modules/content/categories";
import { requireAdmin } from "@/modules/sessions/guards";

const Title = z.string().max(CATEGORY_TITLE_MAX * 2);
const Body = z.union([
  z.object({ move: z.enum(["up", "down"]) }).strict(),
  z.object({ titleVi: Title.optional(), titleEn: Title.nullable().optional(), urlSlug: Title.optional() }).strict()
    .refine((b) => b.titleVi !== undefined || b.titleEn !== undefined || b.urlSlug !== undefined),
]);
type Params = { params: Promise<{ id: string }> };

async function idOf(params: Params["params"]): Promise<string> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "not_found");
  return id;
}

export const PATCH = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const id = await idOf(params);
  const body = await readJson(req, Body);
  if ("move" in body) await moveCategory(ctx, id, body.move);
  else await updateCategory(ctx, id, body);
  return json({ ok: true });
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  await deleteCategory(ctx, await idOf(params));
  return json({ ok: true });
});
