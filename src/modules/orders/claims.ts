import { prisma, withTx, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { audit, auditDenied } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import { lockActiveUser } from "@/modules/auth-learner/devices";
import { mergeGroupIds } from "@/modules/enrollments/access";
import { settleOrder } from "@/modules/enrollments/enroll";
import { enqueueOutbox } from "@/modules/outbox/outbox";
import type { AdminCtx, LearnerCtx } from "@/modules/sessions/guards";
import { putFile } from "@/modules/storage/storage";
import { sepayEnabled } from "./payment-info";

// Chủ quyết định 03/11/2026 (chưa có SePay): khách bấm "Tôi đã chuyển khoản" là học được ngay (quyền mở tạm, không hết hạn).
// Chủ đối soát sau: "Duyệt" ghi khoản tiền vào sổ và thanh toán đơn; "Không thấy tiền" khóa lại kèm lý do,
// khách gửi ảnh chứng minh được. Đơn chỉ thành "đã thanh toán" qua dòng sổ đã xác minh, như mọi nguồn khác.

/** Quá thời gian này kể từ lúc tạo đơn thì không báo đã chuyển được nữa (đặt đơn mới). */
const CLAIM_WINDOW = "24 hours";
const MAX_PROOFS_PER_ORDER = 5;
export const MAX_PROOF_BYTES = 4 * 1024 * 1024;

export type ClaimStatus = "none" | "open" | "approved" | "rejected";
export type ClaimView = { status: ClaimStatus; rejectionReason: string | null; proofs: number };

type OrderRow = { id: string; code: string; status: string; amount_due_vnd: number; course_id: string; title_vi: string; too_late: boolean };

async function lockOrder(tx: Tx, code: string, userIds: string[] | null): Promise<OrderRow | undefined> {
  const [row] = await tx.$queryRaw<OrderRow[]>`
    SELECT o.id, o.code, o.status, o.amount_due_vnd, i.course_id, c.title_vi, o.created_at < now() - ${CLAIM_WINDOW}::interval AS too_late
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id
    WHERE o.code = ${code} AND (${userIds}::uuid[] IS NULL OR o.user_id = ANY(${userIds}::uuid[]))
    FOR UPDATE OF o`;
  return row;
}

/** Trạng thái báo chuyển khoản của một đơn (đọc). */
export async function claimView(db: Tx | ReturnType<typeof prisma>, orderId: string): Promise<ClaimView> {
  const [row] = await db.$queryRaw<{ status: string; claimed: boolean; open: boolean; reason: string | null; proofs: number }[]>`
    SELECT o.status,
           EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id) AS claimed,
           EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id AND e.revoked_at IS NULL) AS open,
           (SELECT r.reason FROM transfer_claim_rejections r WHERE r.order_id = o.id ORDER BY r.created_at DESC LIMIT 1) AS reason,
           (SELECT count(*) FROM transfer_proofs p WHERE p.order_id = o.id)::int AS proofs
    FROM orders o WHERE o.id = ${orderId}::uuid`;
  if (!row || !row.claimed) return { status: "none", rejectionReason: null, proofs: row?.proofs ?? 0 };
  const status: ClaimStatus = row.status === "paid" || row.status === "refunded" ? "approved" : row.open ? "open" : "rejected";
  return { status, rejectionReason: status === "rejected" ? row.reason : null, proofs: row.proofs };
}

/** Đơn còn báo "Tôi đã chuyển khoản" được không (để trang hiện nút): chưa có SePay, chưa báo, chưa thanh toán, tạo chưa quá 24 giờ. */
export async function claimable(db: Tx | ReturnType<typeof prisma>, orderId: string, view: ClaimView): Promise<boolean> {
  if (sepayEnabled(env()) || view.status !== "none") return false;
  const [row] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT status IN ('pending', 'expired') AND created_at >= now() - ${CLAIM_WINDOW}::interval AS ok FROM orders WHERE id = ${orderId}::uuid`;
  return row?.ok ?? false;
}

/** Khách báo đã chuyển khoản: mở tạm khóa của đơn. Bấm lại thì không làm gì thêm. */
export async function claimTransfer(ctx: LearnerCtx, code: string): Promise<ClaimView> {
  // Có SePay thì tiền về là tự mở khóa thật: không mở tạm theo lời khách nữa.
  if (sepayEnabled(env())) throw new HttpError(409, "auto_confirm");
  return withTx(async (tx) => {
    await lockActiveUser(tx, ctx.userId);
    const group = await mergeGroupIds(tx, ctx.userId);
    const order = await lockOrder(tx, code, group);
    if (!order) throw new HttpError(404, "Không tìm thấy đơn");
    const current = await claimView(tx, order.id);
    if (current.status === "open") return current;
    if (current.status === "rejected") throw new HttpError(409, "claim_rejected");
    if (order.status !== "pending" && order.status !== "expired") throw new HttpError(409, "already_paid");
    if (order.too_late) throw new HttpError(409, "too_late");
    const [state] = await tx.$queryRaw<{ enrolled: boolean; open_claim: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM enrollments WHERE user_id = ANY(${group}::uuid[]) AND course_id = ${order.course_id}::uuid AND revoked_at IS NULL) AS enrolled,
             EXISTS (SELECT 1 FROM enrollments WHERE user_id = ANY(${group}::uuid[]) AND source = 'provisional' AND revoked_at IS NULL) AS open_claim`;
    if (state!.enrolled) throw new HttpError(409, "already_enrolled");
    // Chống lạm dụng: mỗi tài khoản chỉ một khóa đang mở tạm chờ duyệt.
    if (state!.open_claim) throw new HttpError(409, "claim_limit");
    await tx.$executeRaw`
      INSERT INTO enrollments (user_id, course_id, source, claim_order_id)
      VALUES (${ctx.userId}::uuid, ${order.course_id}::uuid, 'provisional', ${order.id}::uuid)`;
    await enqueueOutbox(tx, {
      dedupKey: `transfer_claimed:${order.id}`, kind: "transfer_claimed", channel: "telegram",
      payload: { orderCode: order.code, amountVnd: order.amount_due_vnd, courses: [order.title_vi] },
    });
    return claimView(tx, order.id);
  });
}

async function requireOwner(ctx: AdminCtx, action: string, code: string): Promise<void> {
  await authorize(ctx, "payments.match", { action, resource: { type: "order", id: code } });
  if (ctx.role === "owner") return;
  await auditDenied({ adminId: ctx.adminId, action, targetType: "order", targetId: code, reason: "role", ip: ctx.ip });
  throw new HttpError(403, "role");
}

export type ApproveResult = { result: "paid" } | { result: "rejected"; reason: "not_found" | "order_paid" | "order_refunded" | "ref_used" };

class Rollback extends Error {
  constructor(readonly result: ApproveResult) {
    super("rollback");
  }
}

/**
 * Chủ "Duyệt" đơn: đã thấy tiền trong app ngân hàng. Ghi dòng sổ nhập tay (chủ tự xác minh một bước), phân bổ đúng số tiền
 * đơn, đơn → đã thanh toán, quyền mở tạm (nếu có) thay bằng quyền theo đơn. Mã giao dịch (nếu nhập) chống dùng một khoản hai lần.
 */
export async function approveTransfer(
  ctx: AdminCtx,
  input: { orderCode: string; bankRef: string; note: string; bankTime: Date },
): Promise<ApproveResult> {
  const code = input.orderCode.trim().toUpperCase();
  await requireOwner(ctx, "transfer_approve", code);
  const { SEPAY_BANK_CODE: bankCode, SEPAY_ACCOUNT_NO: accountNo } = env();
  if (!bankCode || !accountNo) throw new HttpError(503, "Chưa cấu hình tài khoản nhận tiền");
  const bankRef = input.bankRef.trim().toUpperCase() || `DUYET-${code}`;
  if (bankRef.length > 100) throw new HttpError(400, "Mã giao dịch quá dài");
  if (Number.isNaN(input.bankTime.getTime())) throw new HttpError(400, "bank_time");
  const note = input.note.trim().slice(0, 500);
  const evidence = note ? `Chủ duyệt trên trang đơn: ${note}` : "Chủ duyệt trên trang đơn";

  let result: ApproveResult;
  try {
    result = await withTx(async (tx): Promise<ApproveResult> => {
      // Thứ tự khóa như luồng nhận tiền: dòng sổ trước, rồi mới tới đơn.
      const [peek] = await tx.$queryRaw<{ amount_due_vnd: number; status: string }[]>`SELECT amount_due_vnd, status FROM orders WHERE code = ${code}`;
      if (!peek) return { result: "rejected", reason: "not_found" };
      if (peek.status === "paid") return { result: "rejected", reason: "order_paid" };
      if (peek.status === "refunded") return { result: "rejected", reason: "order_refunded" };
      // Giờ trên sao kê (sổ bất biến ghi đúng giờ ngân hàng, không phải giờ duyệt): không trước lúc tạo đơn, không ở tương lai.
      const [timing] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT ${input.bankTime}::timestamptz >= created_at - interval '5 minutes' AND ${input.bankTime}::timestamptz <= now() + interval '5 minutes' AS ok
        FROM orders WHERE code = ${code}`;
      if (!timing!.ok) throw new HttpError(400, "bank_time");
      const [bt] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO bank_transactions (bank_code, account_no, bank_ref, amount_vnd, content, bank_time, source, entered_by, evidence)
        VALUES (${bankCode}, ${accountNo}, ${bankRef}, ${peek.amount_due_vnd}, ${code}, ${input.bankTime}, 'manual', ${ctx.adminId}::uuid, ${evidence})
        ON CONFLICT (bank_code, account_no, bank_ref) DO NOTHING RETURNING id`;
      if (!bt) return { result: "rejected", reason: "ref_used" };
      const order = await lockOrder(tx, code, null);
      if (order!.status === "paid") throw new Rollback({ result: "rejected", reason: "order_paid" });
      if (order!.status === "refunded") throw new Rollback({ result: "rejected", reason: "order_refunded" });
      await tx.$executeRaw`
        INSERT INTO bank_transaction_verifications (bank_transaction_id, method, verified_by, evidence)
        VALUES (${bt.id}::uuid, 'owner_direct', ${ctx.adminId}::uuid, ${evidence})`;
      await settleOrder(tx, { orderId: order!.id, bankTransactionIds: [bt.id], kind: "manual", allocatedBy: ctx.adminId });
      await audit(tx, {
        adminId: ctx.adminId, action: "transfer_approve", targetType: "order", targetId: order!.id, ip: ctx.ip, reason: note || undefined,
        before: { status: order!.status },
        after: { status: "paid", bankRef, bankTime: input.bankTime.toISOString(), amountVnd: order!.amount_due_vnd, bankTransactionId: bt.id },
        result: "ok",
      });
      return { result: "paid" };
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
    result = error.result;
  }
  if (result.result === "rejected") {
    await auditDenied({ adminId: ctx.adminId, action: "transfer_approve", targetType: "order", targetId: code, reason: result.reason, ip: ctx.ip });
  }
  return result;
}

/** Chủ "Không thấy tiền": khóa lại quyền mở tạm, khách thấy lý do và gửi được ảnh chứng minh. */
export async function rejectClaim(ctx: AdminCtx, input: { orderCode: string; reason: string }): Promise<"revoked" | "not_claimed" | "not_found"> {
  const code = input.orderCode.trim().toUpperCase();
  await requireOwner(ctx, "transfer_claim_reject", code);
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new HttpError(400, "Cần lý do (tối đa 500 ký tự)");
  return withTx(async (tx) => {
    const order = await lockOrder(tx, code, null);
    if (!order) return "not_found";
    if (order.status !== "pending" && order.status !== "expired") return "not_claimed";
    const revoked = await tx.$executeRaw`
      UPDATE enrollments SET revoked_at = now(), revoked_reason = 'rejected'
      WHERE claim_order_id = ${order.id}::uuid AND revoked_at IS NULL`;
    // Đã khóa từ trước: chỉ ghi được quyết định mới khi khách gửi ảnh mới sau lần khóa gần nhất (chủ xem ảnh vẫn không thấy tiền).
    if (revoked === 0) {
      const [fresh] = await tx.$queryRaw<{ ok: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM transfer_proofs p WHERE p.order_id = ${order.id}::uuid
          AND p.created_at > coalesce((SELECT max(r.created_at) FROM transfer_claim_rejections r WHERE r.order_id = ${order.id}::uuid), '-infinity')) AS ok`;
      if (!fresh!.ok) return "not_claimed";
    }
    await tx.$executeRaw`
      INSERT INTO transfer_claim_rejections (order_id, reason, decided_by) VALUES (${order.id}::uuid, ${reason}, ${ctx.adminId}::uuid)`;
    await audit(tx, {
      adminId: ctx.adminId, action: "transfer_claim_reject", targetType: "order", targetId: order.id, ip: ctx.ip, reason,
      before: { claim: revoked > 0 ? "open" : "rejected" }, after: { claim: "rejected" }, result: "ok",
    });
    return "revoked" as const;
  });
}

/** Nhận diện ảnh theo nội dung (không tin tên tệp hay loại khách gửi). */
export function sniffImage(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Khách gửi ảnh chứng minh đã chuyển khoản cho đơn đã báo chuyển (đang mở tạm hoặc bị khóa lại). */
export async function submitProof(ctx: LearnerCtx, code: string, input: { message: string; bytes: Buffer }): Promise<ClaimView> {
  const message = input.message.trim();
  if (message.length > 1000) throw new HttpError(400, "Lời nhắn tối đa 1000 ký tự");
  if (input.bytes.length === 0 || input.bytes.length > MAX_PROOF_BYTES) throw new HttpError(400, "Ảnh cần nhỏ hơn 4 MB");
  const mime = sniffImage(input.bytes);
  if (!mime) throw new HttpError(400, "Chỉ nhận ảnh JPG, PNG hoặc WEBP");
  const group = await mergeGroupIds(null, ctx.userId);
  // Kiểm trước khi ghi tệp để không để lại tệp rác cho đơn không hợp lệ.
  const precheck = await withTx(async (tx) => {
    const order = await lockOrder(tx, code, group);
    if (!order) throw new HttpError(404, "Không tìm thấy đơn");
    return order;
  });
  const stored = await putFile({ bytes: input.bytes, mime, visibility: "protected" });
  return withTx(async (tx) => {
    const order = await lockOrder(tx, code, group);
    if (!order || order.id !== precheck.id) throw new HttpError(404, "Không tìm thấy đơn");
    const view = await claimView(tx, order.id);
    if (view.status !== "open" && view.status !== "rejected") throw new HttpError(409, "not_claimed");
    if (view.proofs >= MAX_PROOFS_PER_ORDER) throw new HttpError(409, "too_many_proofs");
    const [proof] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO transfer_proofs (order_id, user_id, message, storage_key, sha256, mime, bytes)
      VALUES (${order.id}::uuid, ${ctx.userId}::uuid, ${message}, ${stored.storageKey}, ${stored.sha256}, ${mime}, ${stored.bytes}) RETURNING id`;
    await enqueueOutbox(tx, {
      dedupKey: `transfer_proof:${proof!.id}`, kind: "transfer_proof", channel: "telegram",
      payload: { orderCode: order.code, amountVnd: order.amount_due_vnd },
    });
    return claimView(tx, order.id);
  });
}

export type ProofView = { id: string; message: string; createdAt: Date };

/** Ảnh chứng minh của một đơn cho trang quản trị (xem: mọi admin có quyền xem đơn). */
export async function listProofs(ctx: AdminCtx, code: string): Promise<{ proofs: ProofView[]; claim: ClaimView } | null> {
  await authorize(ctx, "orders.view", { action: "transfer_proofs_list" });
  return withTx(async (tx) => {
    const [order] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE code = ${code.trim().toUpperCase()}`;
    if (!order) return null;
    const rows = await tx.$queryRaw<{ id: string; message: string; created_at: Date }[]>`
      SELECT id, message, created_at FROM transfer_proofs WHERE order_id = ${order.id}::uuid ORDER BY created_at`;
    return { proofs: rows.map((r) => ({ id: r.id, message: r.message, createdAt: r.created_at })), claim: await claimView(tx, order.id) };
  });
}

/** Tệp ảnh chứng minh (đường dẫn tra từ DB theo id). */
export async function proofFile(ctx: AdminCtx, proofId: string): Promise<{ storageKey: string; mime: string } | null> {
  await authorize(ctx, "orders.view", { action: "transfer_proof_view" });
  return withTx(async (tx) => {
    const [row] = await tx.$queryRaw<{ storage_key: string; mime: string }[]>`
      SELECT storage_key, mime FROM transfer_proofs WHERE id = ${proofId}::uuid`;
    return row ? { storageKey: row.storage_key, mime: row.mime } : null;
  });
}
