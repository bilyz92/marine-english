import { z } from "zod";
import { clientIp, json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { completeLearnerAuth, deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { loginWithPassword } from "@/modules/auth-learner/password";
import { sessionCookies, ticketCookie } from "@/modules/sessions/cookies";
import { InactiveUserError } from "@/modules/sessions/sessions";

const Body = z.object({
  phone: z.string().max(40),
  password: z.string().max(512),
  newPassword: z.string().max(512).optional(),
  deviceKey: z.string(),
  deviceLabel: z.string().trim().min(1).max(100),
});

/** D2: đăng nhập bằng số + mật khẩu. Sai, số không có tài khoản, tài khoản bị khóa đều trả cùng `invalid`. */
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  const deviceKeyHash = deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const result = await loginWithPassword(
    { phone: body.phone, password: body.password, newPassword: body.newPassword, ip: clientIp(req) },
    async (tx, userId) => {
      try {
        return await completeLearnerAuth(tx, { userId, deviceKeyHash, deviceLabel: body.deviceLabel, authAt: new Date() });
      } catch (error) {
        if (error instanceof InactiveUserError) return null;
        throw error;
      }
    },
  );
  if (result.kind === "weak") return json({ next: "weak_password", problem: result.problem });
  if (result.kind !== "ok") return json({ next: result.kind });
  const outcome = result.value;
  if (outcome.kind === "session") return withCookies(json({ next: "done" }), sessionCookies("learner", outcome.token, outcome.csrf));
  return withCookies(json({ next: "choose_device", devices: outcome.devices }), [ticketCookie(outcome.ticket)]);
});
