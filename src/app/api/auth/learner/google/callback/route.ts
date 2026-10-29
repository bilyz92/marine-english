import { withTx } from "@/lib/db";
import { HttpError, readCookie, redirectTo, route, withCookies } from "@/lib/http";
import { completeLinkGoogle } from "@/modules/auth-learner/link";
import { completeLearnerAuth } from "@/modules/auth-learner/devices";
import { resolveGoogleUser } from "@/modules/auth-learner/google-login";
import { exchangeAndVerify } from "@/modules/auth-oidc/google";
import { consumeOidcState, type OidcStateRow } from "@/modules/auth-oidc/oidc-states";
import { clearOidcCookie, oidcCookieName, sessionCookies, ticketCookie } from "@/modules/sessions/cookies";
import { requireLearner, type LearnerCtx } from "@/modules/sessions/guards";
import { InactiveUserError } from "@/modules/sessions/sessions";

const FAILED = "/dang-nhap?loi=google";

export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const cookieValue = readCookie(req, oidcCookieName("learner"));
  const stateParam = url.searchParams.get("state");
  const done = (path: string, cookies: string[] = []) => withCookies(redirectTo(path), [...cookies, clearOidcCookie("learner")]);

  // Tiêu thụ state trong transaction riêng: dù bước sau lỗi, callback này không chạy lại được.
  const st = cookieValue && stateParam ? await withTx((tx) => consumeOidcState(tx, "learner", cookieValue, stateParam)) : null;
  if (st?.intent === "link") return done(`/tai-khoan?lien-ket=${await linkGoogle(req, url, st)}`);
  if (!st || st.intent !== "login" || !st.deviceKeyHash || !st.deviceLabel) return done(FAILED);
  const claims = await exchangeAndVerify("learner", url, st);
  if (!claims) return done(FAILED);

  const outcome = await withTx(async (tx) => {
    const userId = await resolveGoogleUser(tx, claims);
    if (!userId) return null;
    try {
      return await completeLearnerAuth(tx, { userId, deviceKeyHash: st.deviceKeyHash!, deviceLabel: st.deviceLabel!, authAt: new Date() });
    } catch (error) {
      if (error instanceof InactiveUserError) return null;
      throw error;
    }
  });
  if (!outcome) return done(FAILED);
  if (outcome.kind === "session") return done("/hoc", sessionCookies("learner", outcome.token, outcome.csrf));
  return done("/dang-nhap/chon-thiet-bi", [ticketCookie(outcome.ticket)]);
});

/** Liên kết Google vào tài khoản đang đăng nhập (state tạo ở /api/me/identities/link/start). */
async function linkGoogle(req: Request, url: URL, st: OidcStateRow): Promise<string> {
  let ctx: LearnerCtx;
  try {
    ctx = await requireLearner(req);
  } catch (error) {
    if (error instanceof HttpError) return "invalid";
    throw error;
  }
  if (st.userId !== ctx.userId) return "invalid";
  const claims = await exchangeAndVerify("learner", url, st);
  return claims ? completeLinkGoogle(ctx, st, claims) : "invalid";
}
