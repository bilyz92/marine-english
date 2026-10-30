import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { createOrder } from "@/modules/orders/orders";
import { requireLearner } from "@/modules/sessions/guards";

// Client chỉ gửi khóa học; số tiền luôn do máy chủ tính.
const Body = z.object({ courseSlug: z.string().min(1).max(100) });

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const result = await createOrder(ctx, (await readJson(req, Body)).courseSlug);
  if (!("order" in result)) return json({ error: result.kind }, { status: 409 });
  return json(result.order, { status: result.kind === "created" ? 201 : 200 });
});
