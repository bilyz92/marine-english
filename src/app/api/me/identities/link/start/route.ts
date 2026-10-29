import { z } from "zod";
import { json, readJson, route, withCookies } from "@/lib/http";
import { startLink } from "@/modules/auth-learner/link";
import { oidcCookie } from "@/modules/sessions/cookies";
import { requireLearner } from "@/modules/sessions/guards";

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["email", "phone"]), contact: z.string().max(200) }),
  z.object({ kind: z.literal("google") }),
]);

export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const result = await startLink(ctx, await readJson(req, Body));
  if (result.status === "redirect") {
    return withCookies(json({ status: "redirect", redirectUrl: result.redirectUrl }), [oidcCookie("learner", result.stateCookie)]);
  }
  return json(result, { status: result.status === "reauth_required" ? 403 : 200 });
});
