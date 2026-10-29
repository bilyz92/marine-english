import { withTx, type Tx } from "@/lib/db";

export type AuditEntry = {
  adminId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
  result: "ok" | "denied";
  reason?: string;
  ip?: string;
};

const asJson = (value: unknown) => (value === undefined ? null : JSON.stringify(value));

/** Ghi nhật ký quản trị trong transaction của thao tác (chỉ thêm, không sửa/xóa). */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, before, after, result, reason, ip)
    VALUES (${entry.adminId}::uuid, ${entry.action}, ${entry.targetType}, ${entry.targetId}, ${asJson(entry.before)}::jsonb,
            ${asJson(entry.after)}::jsonb, ${entry.result}, ${entry.reason ?? null}, ${entry.ip ?? null}::inet)`;
}

/** Ghi lần bị từ chối trong transaction riêng (thao tác chính đã rollback). */
export async function auditDenied(entry: Omit<AuditEntry, "result">): Promise<void> {
  await withTx((tx) => audit(tx, { ...entry, result: "denied" }));
}
