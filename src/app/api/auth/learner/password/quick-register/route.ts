import { z } from "zod";
import { clientIp, json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { completeLearnerAuth, deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { generatedPassword, registerWithPassword } from "@/modules/auth-learner/password";
import { canonicalizeEmail } from "@/modules/identity/email";
import { sessionCookies, ticketCookie } from "@/modules/sessions/cookies";

// Mua khóa không cần đăng nhập trước (docs/superpowers/plans/2026-11-05-guest-checkout.md): tên + số (email tùy chọn) → tài khoản mới,
// mật khẩu do hệ thống cấp. Chủ 09/11/2026 (2026-11-09-checkout-credentials.md): không trả mật khẩu ở bước này; mật khẩu hiện ở bước 3
// và gửi vào email khi thanh toán xong, lần đầu đăng nhập phải đổi. Email chưa xác minh: chỉ để gửi thư và nhận ra tài khoản đã có.

const Body = z.object({
  displayName: z.string().trim().min(1).max(100),
  phone: z.string().max(40),
  email: z.string().max(254).optional(),
  /** Nhập lại email: email gõ sai thì thư có mật khẩu tạm tới người lạ, nên phải khớp. */
  emailConfirm: z.string().max(254).optional(),
  deviceKey: z.string(),
  deviceLabel: z.string().trim().min(1).max(100),
});

const STATUS = { invalid_phone: 400, phone_taken: 409, email_taken: 409, throttled: 429 } as const;
const NO_STORE = { "cache-control": "no-store, private" };

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  const deviceKeyHash = deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  let email: string | undefined;
  if (body.email?.trim()) {
    const canonical = canonicalizeEmail(body.email);
    if (!canonical) return json({ error: "invalid_email" }, { status: 400, headers: NO_STORE });
    if (canonicalizeEmail(body.emailConfirm ?? "") !== canonical) return json({ error: "email_mismatch" }, { status: 400, headers: NO_STORE });
    email = canonical;
  }
  const password = generatedPassword();
  const result = await registerWithPassword(
    { phone: body.phone, password, displayName: body.displayName, rank: null, ip: clientIp(req), existingEmail: email, issued: { contactEmail: email } },
    (tx, userId) => completeLearnerAuth(tx, { userId, deviceKeyHash, deviceLabel: body.deviceLabel, authAt: new Date() }),
  );
  // Mật khẩu tự sinh luôn đủ mạnh; nhánh "weak" chỉ để đủ kiểu.
  if (result.kind === "weak") return json({ error: "weak_password" }, { status: 500, headers: NO_STORE });
  if (result.kind !== "ok") return json({ error: result.kind }, { status: STATUS[result.kind], headers: NO_STORE });
  const outcome = result.value;
  if (outcome.kind === "session") return withCookies(json({ next: "done" }, { headers: NO_STORE }), sessionCookies("learner", outcome.token, outcome.csrf));
  return withCookies(json({ next: "choose_device", devices: outcome.devices }, { headers: NO_STORE }), [ticketCookie(outcome.ticket)]);
});
