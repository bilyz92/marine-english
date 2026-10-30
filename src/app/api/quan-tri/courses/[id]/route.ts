import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { updateCourse } from "@/modules/content/catalog";
import { requireAdmin } from "@/modules/sessions/guards";

const Change = z
  .object({ priceVnd: z.number().int().positive().max(100_000_000).optional(), status: z.enum(["draft", "published", "archived"]).optional() })
  .refine((c) => c.priceVnd !== undefined || c.status !== undefined);

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy khóa học");
  const result = await updateCourse(admin, id, await readJson(req, Change));
  if (result === "not_found") throw new HttpError(404, "Không tìm thấy khóa học");
  if (result === "needs_price") return json({ error: "needs_price" }, { status: 409 });
  return json({ result });
});
