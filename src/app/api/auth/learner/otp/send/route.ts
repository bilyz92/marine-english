import { z } from "zod";
import { withTx } from "@/lib/db";
import { clientIp, json, readJson, requireSameOrigin, route } from "@/lib/http";
import { parseContact } from "@/modules/auth-learner/contact";
import { findUserIdByIdentity } from "@/modules/auth-learner/identities";
import { issueOtp } from "@/modules/auth-learner/otp";
import { otpSenderFor } from "@/modules/auth-learner/otp-sender";

const Body = z.object({
  contact: z.string().max(200),
  displayName: z.string().trim().min(1).max(100).optional(),
  rank: z.string().trim().max(100).nullish(),
});

// Phản hồi luôn giống nhau, không lộ email/số đã có tài khoản hay chưa.
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const body = await readJson(req, Body);
  const { kind, value } = parseContact(body.contact);
  const userId = await withTx((tx) => findUserIdByIdentity(tx, kind, value));
  await issueOtp(
    {
      purpose: userId ? "login" : "signup",
      kind,
      value,
      ip: clientIp(req),
      create: userId !== null || body.displayName !== undefined,
    },
    otpSenderFor(kind),
  );
  return json({ ok: true });
});
