import { withTx } from "@/lib/db";
import { readCookie, redirectTo, route, withCookies } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { resolveGoogleAdmin } from "@/modules/auth-admin/identities";
import { exchangeAndVerify } from "@/modules/auth-oidc/google";
import { consumeOidcState } from "@/modules/auth-oidc/oidc-states";
import { clearOidcCookie, oidcCookieName, sessionCookies } from "@/modules/sessions/cookies";
import { createSession } from "@/modules/sessions/sessions";

const FAILED = "/quan-tri/dang-nhap?loi=google";

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const cookieValue = readCookie(req, oidcCookieName("admin"));
  const stateParam = url.searchParams.get("state");
  const done = (path: string, cookies: string[] = []) => withCookies(redirectTo(path), [...cookies, clearOidcCookie("admin")]);

  const st = cookieValue && stateParam ? await withTx((tx) => consumeOidcState(tx, "admin", cookieValue, stateParam)) : null;
  if (st?.intent !== "admin_login") return done(FAILED);
  const claims = await exchangeAndVerify("admin", url, st);
  if (!claims) return done(FAILED);

  const session = await withTx(async (tx) => {
    const adminId = await resolveGoogleAdmin(tx, claims);
    if (!adminId) return null;
    const s = await createSession(tx, { realm: "admin", adminId, authAt: new Date() });
    await audit(tx, { adminId, action: "admin_login", targetType: "admin_user", targetId: adminId, result: "ok", reason: "google" });
    return s;
  });
  if (!session) return done(FAILED);
  return done("/quan-tri", sessionCookies("admin", session.token, session.csrf));
});
