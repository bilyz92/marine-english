import { z } from "zod";
import { withTx } from "@/lib/db";
import { json, parseBody, readBody, requireSameOrigin, route, withCookies } from "@/lib/http";
import { parseContact } from "@/modules/auth-learner/contact";
import { completeLearnerAuth, deviceKeyHashFrom, type AuthOutcome } from "@/modules/auth-learner/devices";
import { createUserWithIdentity, findUserIdByIdentity } from "@/modules/auth-learner/identities";
import { verifyOtp } from "@/modules/auth-learner/otp";
import { sessionCookies, ticketCookie } from "@/modules/sessions/cookies";
import { InactiveUserError } from "@/modules/sessions/sessions";

const Body = z.object({
  contact: z.string().max(200),
  code: z.string().regex(/^\d{6}$/),
  deviceKey: z.string(),
  deviceLabel: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(100).optional(),
  rank: z.string().trim().max(100).nullish(),
});

const INVALID = { next: "invalid" } as const;

export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const raw = await readBody(req);
  const deviceKeyHash = deviceKeyHashFrom(raw);
  const body = parseBody(raw, Body);
  const { kind, value } = parseContact(body.contact);

  // Mã sai, hết hạn, không có thử thách hay tài khoản bị khóa đều trả cùng một body.
  const outcome = await withTx(async (tx): Promise<AuthOutcome | null> => {
    let userId = await findUserIdByIdentity(tx, kind, value);
    if (userId) {
      if ((await verifyOtp(tx, { purpose: "login", kind, value, code: body.code })) !== "ok") return null;
    } else {
      if (!body.displayName) return null;
      if ((await verifyOtp(tx, { purpose: "signup", kind, value, code: body.code })) !== "ok") return null;
      userId = await createUserWithIdentity(tx, { kind, value, displayName: body.displayName, rank: body.rank ?? null });
    }
    try {
      return await completeLearnerAuth(tx, { userId, deviceKeyHash, deviceLabel: body.deviceLabel, authAt: new Date() });
    } catch (error) {
      if (error instanceof InactiveUserError) return null;
      throw error;
    }
  });

  if (!outcome) return json(INVALID);
  if (outcome.kind === "session") return withCookies(json({ next: "done" }), sessionCookies("learner", outcome.token, outcome.csrf));
  return withCookies(json({ next: "choose_device", devices: outcome.devices }), [ticketCookie(outcome.ticket)]);
});
