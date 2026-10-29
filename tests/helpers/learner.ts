import { randomBytes } from "node:crypto";
import { devMailbox } from "@/modules/mail/fake-sink";
import { POST as sendOtp } from "@/app/api/auth/learner/otp/send/route";
import { POST as verifyOtpRoute } from "@/app/api/auth/learner/otp/verify/route";
import { POST as selectDevice } from "@/app/api/auth/learner/device/select/route";
import { ageSendLog } from "./otp";

export const ORIGIN = process.env.APP_ORIGIN!;

export const newDeviceKey = () => randomBytes(32).toString("base64url");

export function post(path: string, body: unknown, cookie?: string): Request {
  const headers: Record<string, string> = { origin: ORIGIN, "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

export function cookieValue(res: Response, name: string): string | undefined {
  const c = res.headers.getSetCookie().find((s) => s.startsWith(`${name}=`));
  return c?.slice(name.length + 1).split(";")[0];
}

export function lastCode(to: string): string {
  const message = devMailbox.messages().filter((m) => m.to === to && m.kind === "otp").at(-1);
  if (!message) throw new Error(`không có thư tới ${to}`);
  return message.body.match(/\b\d{6}\b/)![0];
}

export const send = (body: Record<string, unknown>) => sendOtp(post("/api/auth/learner/otp/send", body));
export const verify = (body: Record<string, unknown>) => verifyOtpRoute(post("/api/auth/learner/otp/verify", body));
export const select = (body: Record<string, unknown>, ticket?: string) =>
  selectDevice(post("/api/auth/learner/device/select", body, ticket ? `__Host-me_ticket=${ticket}` : undefined));

/** Gửi mã rồi xác minh; tự lùi nhật ký gửi để không vướng khoảng chờ 60 giây. */
export async function login(contact: string, deviceKey: string, extra: Record<string, unknown> = {}) {
  await ageSendLog(61_000);
  await send({ contact, ...extra });
  const res = await verify({ contact, code: lastCode(contact.trim().toLowerCase()), deviceKey, deviceLabel: "Điện thoại", ...extra });
  return { res, body: (await res.json()) as { next: string; devices?: { id: string; label: string }[] } };
}

export const signup = (contact: string, deviceKey: string) =>
  login(contact, deviceKey, { displayName: "Nguyễn Văn A", rank: "Thợ máy" });
