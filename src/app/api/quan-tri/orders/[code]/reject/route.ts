import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { rejectClaim } from "@/modules/orders/claims";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ reason: z.string().trim().min(1).max(500) });

// Chủ "Không thấy tiền": khóa lại khóa học mở tạm, khách thấy lý do.
export const POST = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const admin = await requireAdmin(req);
  const { reason } = await readJson(req, Body);
  const result = await rejectClaim(admin, { orderCode: (await ctx.params).code, reason });
  return json({ result }, { status: result === "revoked" ? 200 : result === "not_found" ? 404 : 409 });
});
