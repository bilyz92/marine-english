import { z } from "zod";
import { clientIp, json, readJson, requireSameOrigin, route, withCookies } from "@/lib/http";
import { loginAdminWithPassword } from "@/modules/auth-admin/password";
import { sessionCookies } from "@/modules/sessions/cookies";

const Body = z.object({ email: z.string().max(320), password: z.string().max(1024) });

/** D3: quản trị đăng nhập bằng email + mật khẩu. Không lộ email có trong danh sách hay không. */
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const body = await readJson(req, Body);
  const result = await loginAdminWithPassword({ ...body, ip: clientIp(req) });
  if (result.kind !== "ok") return json({ next: result.kind });
  return withCookies(json({ next: "done" }), sessionCookies("admin", result.token, result.csrf));
});
