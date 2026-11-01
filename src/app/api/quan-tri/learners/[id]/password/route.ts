import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { adminResetPassword } from "@/modules/auth-learner/password";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ reason: z.string().max(1000), evidence: z.string().max(2000), phone: z.string().max(40).optional() });
const STATUS = { not_found: 404, no_password_login: 409, invalid_phone: 400, phone_taken: 409 } as const;

/** Chủ đặt mật khẩu tạm cho học viên (G15). Mật khẩu tạm chỉ trả về một lần, không lưu ở đâu khác ngoài bản băm. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy học viên");
  const result = await adminResetPassword(admin, id, await readJson(req, Body));
  if (result.kind === "ok") return json({ temporaryPassword: result.temporaryPassword }, { headers: { "cache-control": "no-store" } });
  return json({ error: result.kind }, { status: STATUS[result.kind] });
});
