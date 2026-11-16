import { z } from "zod";
import { clientIp, json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { canonicalizeEmail } from "@/modules/identity/email";
import { emailReady } from "@/modules/mail/email-sender";
import { createGuestOrder } from "@/modules/orders/guest";
import { paymentInfo } from "@/modules/orders/payment-info";
import { guestOrderCookie } from "@/modules/sessions/cookies";

// Khách chưa có tài khoản đặt mua (chủ 16/11/2026, docs/superpowers/plans/2026-11-16-guest-orders.md): chỉ tạo đơn; tài khoản tạo khi
// nhận tiền và thông tin đăng nhập chỉ gửi qua email, nên chưa gửi được email thì không nhận đơn. Giá do máy chủ tính.

const Body = z.object({
  courseSlug: z.string().min(1).max(100),
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().max(40),
  email: z.string().max(254),
  /** Nhập lại email: gõ sai thì thư có mật khẩu tạm tới người lạ. */
  emailConfirm: z.string().max(254),
  acceptTerms: z.literal(true),
});

const STATUS = { invalid_phone: 400, invalid_email: 400, phone_taken: 409, email_taken: 409, pending_order: 409, not_for_sale: 409, throttled: 429 } as const;
const NO_STORE = { "cache-control": "no-store, private" };

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const body = parseBody(await readBody(req), Body);
  const info = paymentInfo();
  if (!info) return json({ error: "payment_unavailable" }, { status: 503, headers: NO_STORE });
  if (!emailReady()) return json({ error: "email_unavailable" }, { status: 503, headers: NO_STORE });
  const email = canonicalizeEmail(body.email);
  if (!email) return json({ error: "invalid_email" }, { status: 400, headers: NO_STORE });
  if (canonicalizeEmail(body.emailConfirm) !== email) return json({ error: "email_mismatch" }, { status: 400, headers: NO_STORE });
  const result = await createGuestOrder({
    courseSlug: body.courseSlug, displayName: body.displayName, phone: body.phone, email, ip: clientIp(req), termsVersion: info.termsVersion,
  });
  if (result.kind !== "created") return json({ error: result.kind }, { status: STATUS[result.kind], headers: NO_STORE });
  return withCookies(json({ code: result.order.code }, { status: 201, headers: NO_STORE }), [guestOrderCookie(result.order.code, result.accessToken)]);
});
