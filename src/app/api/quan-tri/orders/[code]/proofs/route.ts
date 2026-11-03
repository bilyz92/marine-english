import { HttpError, json, route } from "@/lib/http";
import { listProofs } from "@/modules/orders/claims";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const admin = await requireAdmin(req);
  const result = await listProofs(admin, (await ctx.params).code);
  if (!result) throw new HttpError(404, "Không tìm thấy đơn");
  return json(result);
});
