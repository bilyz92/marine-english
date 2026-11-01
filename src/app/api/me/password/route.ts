import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { changeOwnPassword } from "@/modules/auth-learner/password";
import { requireLearner } from "@/modules/sessions/guards";

const Body = z.object({
  currentPassword: z.string().max(512).optional(),
  newPassword: z.string().max(512),
  phone: z.string().max(40).optional(),
});

const STATUS = { invalid_current: 400, weak: 400, phone_required: 400, invalid_phone: 400, reauth_required: 403, phone_taken: 409, inactive: 409, locked: 429 } as const;

/** Đổi mật khẩu, hoặc thêm số + mật khẩu cho tài khoản email/Google (D2). */
export const POST = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const result = await changeOwnPassword(ctx, await readJson(req, Body));
  if (result.kind === "ok") return json({ ok: true });
  if (result.kind === "weak") return json({ error: "weak_password", problem: result.problem }, { status: STATUS.weak });
  return json({ error: result.kind }, { status: STATUS[result.kind] });
});
