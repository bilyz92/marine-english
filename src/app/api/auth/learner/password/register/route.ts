import { z } from "zod";
import { clientIp, json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { completeLearnerAuth, deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { registerWithPassword } from "@/modules/auth-learner/password";
import { sessionCookies, ticketCookie } from "@/modules/sessions/cookies";

const Body = z.object({
  phone: z.string().max(40),
  password: z.string().max(512),
  displayName: z.string().trim().min(1).max(100),
  rank: z.string().trim().max(100).nullish(),
  deviceKey: z.string(),
  deviceLabel: z.string().trim().min(1).max(100),
});

const ERRORS = { invalid_phone: 400, weak: 400, phone_taken: 409, email_taken: 409, throttled: 429 } as const;

/** D2: tạo tài khoản bằng số điện thoại (chưa xác minh) + mật khẩu, rồi vào luôn như các cách đăng nhập khác (giới hạn 2 máy). */
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  const deviceKeyHash = deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const result = await registerWithPassword(
    { phone: body.phone, password: body.password, displayName: body.displayName, rank: body.rank ?? null, ip: clientIp(req) },
    (tx, userId) => completeLearnerAuth(tx, { userId, deviceKeyHash, deviceLabel: body.deviceLabel, authAt: new Date() }),
  );
  if (result.kind === "weak") return json({ error: "weak_password", problem: result.problem }, { status: ERRORS.weak });
  if (result.kind !== "ok") return json({ error: result.kind }, { status: ERRORS[result.kind] });
  const outcome = result.value;
  if (outcome.kind === "session") return withCookies(json({ next: "done" }), sessionCookies("learner", outcome.token, outcome.csrf));
  return withCookies(json({ next: "choose_device", devices: outcome.devices }), [ticketCookie(outcome.ticket)]);
});
