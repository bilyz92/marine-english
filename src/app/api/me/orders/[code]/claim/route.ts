import { json, route } from "@/lib/http";
import { claimTransfer } from "@/modules/orders/claims";
import { requireLearner } from "@/modules/sessions/guards";

// Khách bấm "Tôi đã chuyển khoản": mở tạm khóa của đơn (quyết định của chủ 03/11/2026), chủ đối soát sau.
export const POST = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const learner = await requireLearner(req);
  return json(await claimTransfer(learner, (await ctx.params).code.toUpperCase()));
});
