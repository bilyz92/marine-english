import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { setOwnAdminPassword } from "@/modules/auth-admin/password";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ password: z.string().max(1024) });

/** D3: quản trị đặt hoặc đổi mật khẩu của chính mình (cần đăng nhập trong 10 phút gần đây). */
export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const { password } = await readJson(req, Body);
  const result = await setOwnAdminPassword(ctx, password);
  if (result.kind === "weak") return json({ error: "weak_password", problem: result.problem }, { status: 400 });
  return json({ ok: true });
});
