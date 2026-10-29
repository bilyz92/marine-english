import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { completeLinkOtp } from "@/modules/auth-learner/link";
import { requireLearner } from "@/modules/sessions/guards";

const Body = z.object({ kind: z.enum(["email", "phone"]), contact: z.string().max(200), code: z.string().regex(/^\d{6}$/) });

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const result = await completeLinkOtp(ctx, await readJson(req, Body));
  return json({ result }, { status: result === "reauth_required" ? 403 : 200 });
});
