import { z } from "zod";
import { json, parseBody, readBody, readCookie, requireSameOrigin, route, withCookies } from "@/lib/http";
import { consumeTicketAndReplace, deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { clearTicketCookie, sessionCookies, ticketCookieName } from "@/modules/sessions/cookies";

const Body = z.object({ deviceKey: z.string(), replaceDeviceId: z.uuid() });

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const ticket = readCookie(req, ticketCookieName);
  const result = ticket ? await consumeTicketAndReplace({ ticket, ...body }) : null;
  if (!result) return withCookies(json({ next: "invalid" }), [clearTicketCookie()]);
  return withCookies(json({ next: "done" }), [...sessionCookies("learner", result.token, result.csrf), clearTicketCookie()]);
});
