import { z } from "zod";
import { clientIp, json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { completeLearnerAuth, deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { resetPasswordWithCode } from "@/modules/auth-learner/password";
import { sessionCookies, ticketCookie } from "@/modules/sessions/cookies";
import { InactiveUserError } from "@/modules/sessions/sessions";

const Body = z.object({
  phone: z.string().max(40),
  code: z.string().max(10),
  newPassword: z.string().max(512),
  deviceKey: z.string(),
  deviceLabel: z.string().trim().min(1).max(100),
});

/** Đặt mật khẩu mới bằng mã gửi tới email đã liên kết, rồi vào luôn. Mã sai, hết hạn, không đúng người đều trả `invalid`. */
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  const deviceKeyHash = deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const result = await resetPasswordWithCode({ phone: body.phone, code: body.code, newPassword: body.newPassword, ip: clientIp(req) }, async (tx, userId) => {
    try {
      return await completeLearnerAuth(tx, { userId, deviceKeyHash, deviceLabel: body.deviceLabel, authAt: new Date() });
    } catch (error) {
      if (error instanceof InactiveUserError) return null;
      throw error;
    }
  });
  if (result.kind === "weak") return json({ next: "weak_password", problem: result.problem });
  if (result.kind !== "ok") return json({ next: result.kind });
  const outcome = result.value;
  if (outcome.kind === "session") return withCookies(json({ next: "done" }), sessionCookies("learner", outcome.token, outcome.csrf));
  return withCookies(json({ next: "choose_device", devices: outcome.devices }), [ticketCookie(outcome.ticket)]);
});
