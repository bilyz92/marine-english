import { z } from "zod";
import { withTx } from "@/lib/db";
import { json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { deviceKeyHashFrom } from "@/modules/auth-learner/devices";
import { authorizationUrl, requireGoogle } from "@/modules/auth-oidc/google";
import { createOidcState } from "@/modules/auth-oidc/oidc-states";
import { oidcCookie } from "@/modules/sessions/cookies";

const Body = z.object({ deviceKey: z.string(), deviceLabel: z.string().trim().min(1).max(100) });

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  requireGoogle();
  const raw = await readBody(req);
  deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const st = await withTx((tx) => createOidcState(tx, { realm: "learner", intent: "login", ...body }));
  return withCookies(json({ redirectUrl: await authorizationUrl("learner", st) }), [oidcCookie("learner", st.cookieValue)]);
});
