import { prisma } from "@/lib/db";
import { json, route } from "@/lib/http";
import { permissionsFor } from "@/modules/auth-admin/authorize";
import { adminHasPassword } from "@/modules/auth-admin/password";
import { requireAdmin } from "@/modules/sessions/guards";

/** Nguồn duy nhất để giao diện ẩn hiện mục theo vai trò; quyền thật vẫn kiểm ở từng API. */
export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const admin = await prisma().adminUser.findUniqueOrThrow({ where: { id: ctx.adminId }, select: { emailLower: true } });
  return json({ email: admin.emailLower, role: ctx.role, permissions: permissionsFor(ctx), hasPassword: await adminHasPassword(ctx.adminId) });
});
