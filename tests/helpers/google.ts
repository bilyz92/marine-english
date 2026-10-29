import { OAuth2Server } from "oauth2-mock-server";
import { POST as startRoute } from "@/app/api/auth/learner/google/start/route";
import { GET as callbackRoute } from "@/app/api/auth/learner/google/callback/route";
import { cookieValue, newDeviceKey, post } from "./learner";

export type IdClaims = { sub: string; email?: string; email_verified?: boolean; iss?: string; aud?: string; nonce?: string };

/** Issuer giả: mỗi lần cấp token lấy claims kế tiếp trong hàng đợi. */
export class FakeGoogle {
  readonly server = new OAuth2Server();
  private queue: IdClaims[] = [];

  async start(): Promise<string> {
    await this.server.issuer.keys.generate("RS256");
    await this.server.start(0, "localhost");
    this.server.service.on("beforeTokenSigning", (token) => {
      // Hook chạy cho cả access token; chỉ ID token mang nonce.
      if (!("nonce" in token.payload)) return;
      const next = this.queue.shift();
      if (next) Object.assign(token.payload, next);
    });
    return this.server.issuer.url!;
  }

  stop() {
    return this.server.stop();
  }

  reset() {
    this.queue = [];
  }

  nextToken(claims: IdClaims) {
    this.queue.push(claims);
  }
}

export type Started = { stateCookie: string; redirectUrl: string; deviceKey: string };

export async function startGoogle(deviceKey = newDeviceKey()): Promise<Started> {
  const res = await startRoute(post("/api/auth/learner/google/start", { deviceKey, deviceLabel: "Điện thoại" }));
  if (res.status !== 200) throw new Error(`start ${res.status}`);
  const { redirectUrl } = (await res.json()) as { redirectUrl: string };
  return { stateCookie: cookieValue(res, "__Host-me_oidc_learner")!, redirectUrl, deviceKey };
}

/** Đi qua trang authorize của issuer giả, lấy URL callback có code + state. */
export async function authorize(started: Started): Promise<string> {
  const res = await fetch(started.redirectUrl, { redirect: "manual" });
  return res.headers.get("location")!;
}

export function callback(callbackUrl: string, stateCookie: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (stateCookie) headers.cookie = `__Host-me_oidc_learner=${stateCookie}`;
  return callbackRoute(new Request(callbackUrl, { headers }));
}

export async function googleLogin(claims: IdClaims, fake: FakeGoogle, deviceKey?: string) {
  const started = await startGoogle(deviceKey);
  fake.nextToken(claims);
  return callback(await authorize(started), started.stateCookie);
}
