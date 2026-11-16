import { HttpError, json, readCookie, route } from "@/lib/http";
import { getCheckoutForGuest } from "@/modules/orders/orders";
import { guestOrderCookieName } from "@/modules/sessions/cookies";

// Trang đơn của khách chưa có tài khoản: chỉ mở bằng mã truy cập trong cookie của đơn đó (không có hay sai → 404 như đơn không tồn tại).

export const GET = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const code = (await ctx.params).code.trim().toUpperCase();
  const token = readCookie(req, guestOrderCookieName(code));
  const order = token ? await getCheckoutForGuest(code, token) : null;
  if (!order) throw new HttpError(404, "Không tìm thấy đơn");
  return json(order, { headers: { "cache-control": "no-store, private" } });
});
