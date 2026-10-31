import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { listMyOrdersForRefund, PayoutSchema, requestRefundAsLearner } from "@/modules/refunds/refunds";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  return json({ orders: await listMyOrdersForRefund(ctx) });
});

const Body = z.object({ orderCode: z.string().min(1).max(20), reason: z.string().trim().min(1).max(1000), payout: PayoutSchema });

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const result = await requestRefundAsLearner(ctx, await readJson(req, Body));
  if ("refundId" in result) return json(result, { status: 201 });
  return json({ error: result.rejected }, { status: result.rejected === "not_found" ? 404 : 409 });
});
