import { withTx } from "@/lib/db";
import { json, requireSameOrigin, route, withCookies } from "@/lib/http";
import { authorizationUrl, requireGoogle } from "@/modules/auth-oidc/google";
import { createOidcState } from "@/modules/auth-oidc/oidc-states";
import { oidcCookie } from "@/modules/sessions/cookies";

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  requireGoogle();
  const st = await withTx((tx) => createOidcState(tx, { realm: "admin", intent: "admin_login" }));
  return withCookies(json({ redirectUrl: await authorizationUrl("admin", st) }), [oidcCookie("admin", st.cookieValue)]);
});
