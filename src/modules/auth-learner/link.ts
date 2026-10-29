import { withTx, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import type { GoogleClaims } from "@/modules/auth-oidc/google";
import { authorizationUrl } from "@/modules/auth-oidc/google";
import { createOidcState, type OidcStateRow } from "@/modules/auth-oidc/oidc-states";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { isRecentAuth } from "@/modules/sessions/sessions";
import { parseContact } from "./contact";
import { lockActiveUser } from "./devices";
import type { IdentityKind } from "./identities";
import { issueOtp, verifyOtp } from "./otp";
import { otpSenderFor } from "./otp-sender";

// Liên kết thêm cách đăng nhập: chỉ khi đã xác thực trong 10 phút gần đây và chứng minh được định danh mới.

export type StartLinkInput = { kind: "email" | "phone"; contact: string } | { kind: "google" };
export type StartLinkResult =
  | { status: "sent" | "throttled" | "reauth_required" }
  | { status: "redirect"; redirectUrl: string; stateCookie: string };
export type LinkResult = "linked" | "invalid" | "owned_by_other";

function contactOfKind(kind: "email" | "phone", contact: string) {
  const parsed = parseContact(contact);
  if (parsed.kind !== kind) throw new HttpError(400, "Cách liên hệ không khớp loại định danh");
  return parsed;
}

export async function startLink(ctx: LearnerCtx, input: StartLinkInput): Promise<StartLinkResult> {
  if (!isRecentAuth(ctx.authAt)) return { status: "reauth_required" };
  if (input.kind === "google") {
    const st = await withTx((tx) => createOidcState(tx, { realm: "learner", intent: "link", userId: ctx.userId }));
    return { status: "redirect", redirectUrl: await authorizationUrl("learner", st), stateCookie: st.cookieValue };
  }
  const { kind, value } = contactOfKind(input.kind, input.contact);
  const result = await issueOtp({ purpose: "link", kind, value, ip: ctx.ip, userId: ctx.userId, create: true }, otpSenderFor(kind));
  // Lỗi gửi được báo như đã gửi: người dùng bấm gửi lại như mọi lần chưa nhận được mã.
  return { status: result === "throttled" ? "throttled" : "sent" };
}

/** Gắn định danh đã chứng minh vào người dùng; định danh đã thuộc người khác thì không đổi gì. */
async function attachIdentity(tx: Tx, userId: string, kind: IdentityKind, value: string): Promise<"linked" | "owned_by_other"> {
  await lockActiveUser(tx, userId);
  const inserted = await tx.$executeRaw`
    INSERT INTO user_identities (user_id, kind, value_canonical, verified_at)
    VALUES (${userId}::uuid, ${kind}, ${value}, now())
    ON CONFLICT (kind, value_canonical) DO NOTHING`;
  if (inserted === 1) return "linked";
  const [owner] = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT user_id FROM user_identities WHERE kind = ${kind} AND value_canonical = ${value}`;
  return owner?.user_id === userId ? "linked" : "owned_by_other";
}

/** Mã OTP luôn bị tiêu thụ khi đúng (transaction commit cả khi định danh thuộc người khác). */
export async function completeLinkOtp(
  ctx: LearnerCtx,
  input: { kind: "email" | "phone"; contact: string; code: string },
): Promise<LinkResult | "reauth_required"> {
  if (!isRecentAuth(ctx.authAt)) return "reauth_required";
  const { kind, value } = contactOfKind(input.kind, input.contact);
  return withTx(async (tx) => {
    const verified = await verifyOtp(tx, { purpose: "link", kind, value, code: input.code, userId: ctx.userId });
    if (verified !== "ok") return "invalid";
    return attachIdentity(tx, ctx.userId, kind, value);
  });
}

export async function completeLinkGoogle(ctx: LearnerCtx, st: OidcStateRow, claims: GoogleClaims): Promise<LinkResult> {
  if (st.intent !== "link" || st.userId !== ctx.userId) return "invalid";
  return withTx((tx) => attachIdentity(tx, ctx.userId, "google", claims.sub));
}

export async function unlinkIdentity(
  ctx: LearnerCtx,
  identityId: string,
): Promise<"unlinked" | "reauth_required" | "last_identity" | "not_found"> {
  if (!isRecentAuth(ctx.authAt)) return "reauth_required";
  return withTx(async (tx) => {
    await lockActiveUser(tx, ctx.userId);
    const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM user_identities WHERE user_id = ${ctx.userId}::uuid`;
    if (!ids.some((r) => r.id === identityId)) return "not_found";
    if (ids.length < 2) return "last_identity";
    await tx.$executeRaw`DELETE FROM user_identities WHERE id = ${identityId}::uuid`;
    return "unlinked";
  });
}
