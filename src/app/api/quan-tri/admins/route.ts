import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError, json, readJson, route } from "@/lib/http";
import { changeAdmin, inviteAdmin } from "@/modules/auth-admin/admins";
import { authorize } from "@/modules/auth-admin/authorize";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "admins.manage", { action: "admins_list" });
  const rows = await prisma().adminUser.findMany({ orderBy: { createdAt: "asc" } });
  return json({
    admins: rows.map((a) => ({
      id: a.id, email: a.emailLower, role: a.role, status: a.status,
      invitedAt: a.invitedAt, inviteExpiresAt: a.inviteExpiresAt, activatedAt: a.activatedAt,
    })),
  });
});

const Role = z.enum(["owner", "support"]);
const Invite = z.object({ email: z.string().max(200), role: Role });

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "admins.manage", { action: "admin_invite" });
  const result = await inviteAdmin(ctx, await readJson(req, Invite));
  if (result === "invalid_email") throw new HttpError(400, "Email không hợp lệ");
  return json({ result });
});

// Kích hoạt lại người đã bị thu hồi phải qua lời mời mới (chứng minh lại email), nên PATCH chỉ cho thu hồi.
const Change = z
  .object({ adminId: z.uuid(), role: Role.optional(), status: z.literal("revoked").optional() })
  .refine((c) => c.role !== undefined || c.status !== undefined);

export const PATCH = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const { adminId, ...change } = await readJson(req, Change);
  await authorize(ctx, "admins.manage", { action: "admin_change", resource: { type: "admin_user", id: adminId } });
  const result = await changeAdmin(ctx, adminId, change);
  if (result === "last_owner") return json({ error: "last_owner" }, { status: 409 });
  if (result === "not_owner") throw new HttpError(403, "role");
  if (result === "not_found") throw new HttpError(404, "Không tìm thấy quản trị viên");
  return json({ result });
});
