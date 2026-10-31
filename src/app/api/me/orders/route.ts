import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { createOrder } from "@/modules/orders/orders";
import { paymentInfo } from "@/modules/orders/payment-info";
import { requireLearner } from "@/modules/sessions/guards";

// Client chỉ gửi khóa học; số tiền luôn do máy chủ tính.
const Body = z.object({ courseSlug: z.string().min(1).max(100), acceptTerms: z.literal(true) });

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const { courseSlug } = await readJson(req, Body);
  // Chưa đủ thông tin nhận tiền hoặc chưa có điều khoản đã duyệt thì không tạo đơn.
  const info = paymentInfo();
  if (!info) return json({ error: "payment_unavailable" }, { status: 503 });
  const result = await createOrder(ctx, courseSlug, { termsVersion: info.termsVersion });
  if (!("order" in result)) return json({ error: result.kind }, { status: 409 });
  return json(result.order, { status: result.kind === "created" ? 201 : 200 });
});
