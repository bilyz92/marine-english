import { HttpError, json, route } from "@/lib/http";
import { getOrderForLearner } from "@/modules/orders/orders";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const learner = await requireLearner(req);
  const order = await getOrderForLearner(learner, (await ctx.params).code);
  if (!order) throw new HttpError(404, "Không tìm thấy đơn");
  return json(order);
});
