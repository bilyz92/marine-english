import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";

const MAX_PAGE = 50;
// Con trỏ giữ đủ micro giây của created_at: Date của JS chỉ tới mili giây, mất phần lẻ sẽ bỏ sót đơn.
const Cursor = z.object({ t: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), id: z.uuid() });
export const ORDER_STATUSES = ["pending", "paid", "expired", "refunded"] as const;
/** Lọc thêm: đơn chờ chủ đối soát (đang mở tạm, hoặc bị khóa lại mà khách đã gửi ảnh chứng minh sau đó). */
const CLAIMED = "claimed";

function decodeCursor(cursor: string | null): z.infer<typeof Cursor> | null {
  if (!cursor) return null;
  try {
    return Cursor.parse(JSON.parse(Buffer.from(cursor, "base64url").toString()));
  } catch {
    throw new HttpError(400, "Con trỏ không hợp lệ");
  }
}

/** Danh sách đơn mới nhất trước; tìm chính xác theo mã đơn, không dùng ký tự đại diện. */
export async function listOrders(ctx: AdminCtx, input: { status: string | null; q: string | null; cursor: string | null; limit: number }) {
  await authorize(ctx, "orders.view", { action: "orders_list" });
  if (input.status && input.status !== CLAIMED && !(ORDER_STATUSES as readonly string[]).includes(input.status)) throw new HttpError(400, "Trạng thái không hợp lệ");
  const claimedOnly = input.status === CLAIMED;
  const status = claimedOnly ? null : input.status;
  const after = decodeCursor(input.cursor);
  const limit = Math.min(Math.max(input.limit, 1), MAX_PAGE);
  const code = input.q?.trim().toUpperCase() || null;
  const rows = await prisma().$queryRaw<{ id: string; code: string; status: string; amount_due_vnd: number; created_at: Date; created_exact: string; paid_at: Date | null; expires_at: Date; title_vi: string; display_name: string; user_id: string; claim: "open" | "rejected" | null; proofs: number; needs_review: boolean }[]>`
    WITH base AS (
    SELECT o.id, to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_exact, o.code, o.status, o.amount_due_vnd, o.created_at, o.paid_at, o.expires_at, c.title_vi, u.display_name, o.user_id,
      CASE WHEN EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id AND e.revoked_at IS NULL) THEN 'open'
           WHEN o.status IN ('pending', 'expired') AND EXISTS (SELECT 1 FROM enrollments e WHERE e.claim_order_id = o.id) THEN 'rejected'
      END AS claim,
      (SELECT count(*) FROM transfer_proofs p WHERE p.order_id = o.id)::int AS proofs,
      EXISTS (SELECT 1 FROM transfer_proofs p WHERE p.order_id = o.id
              AND p.created_at > coalesce((SELECT max(r.created_at) FROM transfer_claim_rejections r WHERE r.order_id = o.id), '-infinity')) AS new_proof
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id JOIN users u ON u.id = o.user_id
    WHERE (${status}::text IS NULL OR o.status = ${status})
      AND (${code}::text IS NULL OR o.code = ${code})
      AND (${after?.t ?? null}::timestamptz IS NULL OR (o.created_at, o.id) < (${after?.t ?? null}::timestamptz, ${after?.id ?? null}::uuid))
    )
    SELECT *, coalesce(claim = 'open' OR (claim = 'rejected' AND new_proof), false) AS needs_review FROM base
    WHERE (NOT ${claimedOnly} OR claim = 'open' OR (claim = 'rejected' AND new_proof))
    ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    orders: page.map((o) => ({
      code: o.code, status: o.status, amountVnd: o.amount_due_vnd, createdAt: o.created_at, paidAt: o.paid_at, expiresAt: o.expires_at,
      course: o.title_vi, learner: o.display_name, userId: o.user_id, claim: o.claim, proofs: o.proofs, needsReview: o.needs_review,
    })),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ t: last.created_exact, id: last.id })).toString("base64url") : null,
  };
}
