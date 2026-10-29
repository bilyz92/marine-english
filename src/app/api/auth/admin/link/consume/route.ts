import { z } from "zod";
import { json, readJson, requireSameOrigin, route, withCookies } from "@/lib/http";
import { consumeAdminLink } from "@/modules/auth-admin/email-link";
import { sessionCookies } from "@/modules/sessions/cookies";

const Body = z.object({ token: z.string().max(100) });

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const { token } = await readJson(req, Body);
  const session = await consumeAdminLink(token);
  if (!session) return json({ next: "invalid" });
  return withCookies(json({ next: "done" }), sessionCookies("admin", session.token, session.csrf));
});
