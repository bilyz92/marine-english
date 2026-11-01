import { z } from "zod";
import { clientIp, json, readJson, requireSameOrigin, route } from "@/lib/http";
import { sendPasswordReset } from "@/modules/auth-learner/password";

const Body = z.object({ phone: z.string().max(40) });

/** Quên mật khẩu: luôn trả như nhau, không lộ số có tài khoản hay có email liên kết không. */
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const { phone } = await readJson(req, Body);
  await sendPasswordReset({ phone, ip: clientIp(req) });
  return json({ ok: true });
});
