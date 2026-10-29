import * as oauth from "oauth4webapi";
import { env } from "@/lib/env";
import type { Realm } from "@/modules/sessions/sessions";
import type { OidcStateRow } from "./oidc-states";

// Google OIDC: Authorization Code + PKCE S256, kiểm iss/aud/exp/nonce của ID token.
// Dùng oauth4webapi (lõi của openid-client) để chấp nhận cả hai dạng iss Google công bố.
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type GoogleClaims = { sub: string; email: string | null; emailVerified: boolean };

const discovered = new Map<string, Promise<oauth.AuthorizationServer>>();

function requestOptions(issuer: URL) {
  // Chỉ issuer giả trong test/dev chạy http.
  const insecure = issuer.protocol === "http:" && process.env.NODE_ENV !== "production";
  return insecure ? { [oauth.allowInsecureRequests]: true } : {};
}

function authServer(): Promise<oauth.AuthorizationServer> {
  const issuer = new URL(env().GOOGLE_ISSUER);
  let found = discovered.get(issuer.href);
  if (!found) {
    found = oauth
      .discoveryRequest(issuer, requestOptions(issuer))
      .then((res) => oauth.processDiscoveryResponse(issuer, res));
    found.catch(() => discovered.delete(issuer.href));
    discovered.set(issuer.href, found);
  }
  return found;
}

const client = (): oauth.Client => ({ client_id: env().GOOGLE_CLIENT_ID });

export function redirectUri(realm: Realm): string {
  return `${env().APP_ORIGIN}/api/auth/${realm}/google/callback`;
}

export async function authorizationUrl(
  realm: Realm,
  st: { state: string; nonce: string; codeVerifier: string },
  loginHint?: string,
): Promise<string> {
  const as = await authServer();
  const url = new URL(as.authorization_endpoint!);
  url.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(realm),
    response_type: "code",
    scope: "openid email",
    state: st.state,
    nonce: st.nonce,
    code_challenge: await oauth.calculatePKCECodeChallenge(st.codeVerifier),
    code_challenge_method: "S256",
    ...(loginHint ? { login_hint: loginHint } : {}),
  }).toString();
  return url.toString();
}

/** iss chưa kiểm chữ ký, chỉ để chọn issuer mong đợi trong tập cho phép; mọi kiểm tra thật do oauth4webapi làm. */
function unverifiedIssuer(body: unknown): string | null {
  const token = (body as { id_token?: unknown } | null)?.id_token;
  if (typeof token !== "string") return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { iss?: unknown };
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

/** Đổi code lấy token và kiểm ID token. State đã được kiểm qua DB trước khi gọi. Lỗi bất kỳ → null. */
export async function exchangeAndVerify(realm: Realm, url: URL, st: OidcStateRow): Promise<GoogleClaims | null> {
  try {
    const as = await authServer();
    const params = oauth.validateAuthResponse(as, client(), url.searchParams, oauth.skipStateCheck);
    const response = await oauth.authorizationCodeGrantRequest(
      as, client(), oauth.ClientSecretPost(env().GOOGLE_CLIENT_SECRET), params, redirectUri(realm), st.codeVerifier,
      requestOptions(new URL(as.issuer)),
    );
    const iss = unverifiedIssuer(await response.clone().json().catch(() => null));
    const allowed = new Set([as.issuer, ...GOOGLE_ISSUERS]);
    const expected = iss && allowed.has(iss) ? { ...as, issuer: iss } : as;
    const result = await oauth.processAuthorizationCodeResponse(expected, client(), response, {
      expectedNonce: st.nonce,
      requireIdToken: true,
    });
    const claims = oauth.getValidatedIdTokenClaims(result)!;
    return {
      sub: claims.sub,
      email: typeof claims.email === "string" ? claims.email : null,
      emailVerified: claims.email_verified === true,
    };
  } catch {
    return null;
  }
}
