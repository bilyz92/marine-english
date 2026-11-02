import { json, route } from "@/lib/http";
import { paymentHistory } from "@/modules/orders/orders";
import { requireLearner } from "@/modules/sessions/guards";

/** Lịch sử thanh toán của học viên đang đăng nhập. */
export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  return json({ payments: await paymentHistory(ctx) });
});
