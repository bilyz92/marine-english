import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { setCourseCategory } from "@/modules/content/categories";
import { requireAdmin } from "@/modules/sessions/guards";

// Chọn danh mục cho một khóa (null = "Khóa khác").
const Body = z.object({ categoryId: z.uuid().nullable() });

export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "not_found");
  const { categoryId } = await readJson(req, Body);
  await setCourseCategory(admin, id, categoryId);
  return json({ ok: true });
});
