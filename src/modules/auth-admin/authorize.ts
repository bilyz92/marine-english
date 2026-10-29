import { HttpError } from "@/lib/http";
import { auditDenied } from "@/modules/audit/audit";
import type { AdminCtx } from "@/modules/sessions/guards";
import { isRecentAuth } from "@/modules/sessions/sessions";

// Ma trận quyền quản trị theo DG §5 (đề xuất, chờ cổng G11). Kiểm ở máy chủ cho mọi thao tác quản trị.

export const PERMISSIONS = [
  "orders.view", "payments.match", "grants.create", "refunds.request", "refunds.approve", "accounts.merge", "prices.edit",
  "coupons.edit", "data.export", "admins.manage", "bank.raw.view", "learner.phone.view", "devices.remove", "jobs.run",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type ResourceCtx = { type: string; id: string; assignedAdminId?: string | null };

type Rule = {
  roles: ReadonlyArray<"owner" | "support">;
  /** Cần xác thực trong 10 phút gần đây. */
  recentAuth?: boolean;
  /** Điều kiện theo tài nguyên; chỉ áp cho support (owner có mọi quyền). */
  condition?: (ctx: AdminCtx, resource?: ResourceCtx) => boolean;
};

const OWNER = ["owner"] as const;
const BOTH = ["owner", "support"] as const;
const assignedToMe = (ctx: AdminCtx, resource?: ResourceCtx) => resource?.assignedAdminId === ctx.adminId;

export const POLICY: Record<Permission, Rule> = {
  "orders.view": { roles: BOTH },
  "payments.match": { roles: BOTH },
  "refunds.request": { roles: BOTH },
  "devices.remove": { roles: BOTH },
  "bank.raw.view": { roles: BOTH, condition: assignedToMe },
  "learner.phone.view": { roles: BOTH, condition: assignedToMe },
  "grants.create": { roles: OWNER, recentAuth: true },
  "refunds.approve": { roles: OWNER, recentAuth: true },
  "accounts.merge": { roles: OWNER, recentAuth: true },
  "prices.edit": { roles: OWNER, recentAuth: true },
  "coupons.edit": { roles: OWNER, recentAuth: true },
  "data.export": { roles: OWNER, recentAuth: true },
  "admins.manage": { roles: OWNER, recentAuth: true },
  "jobs.run": { roles: OWNER },
};

type Denial = "role" | "reauth_required" | "condition";

function denial(ctx: AdminCtx, rule: Rule, resource?: ResourceCtx): Denial | null {
  const role = ctx.role as "owner" | "support";
  if (!rule.roles.includes(role)) return "role";
  if (rule.recentAuth && !isRecentAuth(ctx.authAt)) return "reauth_required";
  if (role !== "owner" && rule.condition && !rule.condition(ctx, resource)) return "condition";
  return null;
}

/** Từ chối thì ghi nhật ký 'denied' rồi ném HttpError(403, lý do). */
export async function authorize(ctx: AdminCtx, perm: Permission, input: { action: string; resource?: ResourceCtx }): Promise<void> {
  const reason = denial(ctx, POLICY[perm], input.resource);
  if (!reason) return;
  await auditDenied({
    adminId: ctx.adminId,
    action: input.action,
    targetType: input.resource?.type ?? perm,
    targetId: input.resource?.id ?? null,
    reason,
    ip: ctx.ip,
  });
  throw new HttpError(403, reason);
}
