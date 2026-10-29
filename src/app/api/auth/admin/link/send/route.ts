import { z } from "zod";
import { json, readBody, requireSameOrigin, route } from "@/lib/http";
import { issueAdminLink } from "@/modules/auth-admin/email-link";
import { emailSender } from "@/modules/mail/email-sender";

const Body = z.object({ email: z.string().max(200) });

// Luôn cùng một phản hồi, kể cả email không có trong danh sách hoặc sai định dạng.
export const POST = route(async (req: Request) => {
  requireSameOrigin(req);
  const body = Body.safeParse(await readBody(req));
  if (body.success) await issueAdminLink(body.data.email, emailSender());
  return json({ ok: true });
});
