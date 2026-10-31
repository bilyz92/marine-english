import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";

const MAX_PAGE = 50;
const Cursor = z.object({ t: z.iso.datetime(), id: z.uuid() });
export const ORDER_STATUSES = ["pending", "paid", "expired", "refunded"] as const;

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
  if (input.status && !(ORDER_STATUSES as readonly string[]).includes(input.status)) throw new HttpError(400, "Trạng thái không hợp lệ");
  const after = decodeCursor(input.cursor);
  const limit = Math.min(Math.max(input.limit, 1), MAX_PAGE);
  const code = input.q?.trim().toUpperCase() || null;
  const rows = await prisma().$queryRaw<{ id: string; code: string; status: string; amount_due_vnd: number; created_at: Date; paid_at: Date | null; expires_at: Date; title_vi: string; display_name: string; user_id: string }[]>`
    SELECT o.id, o.code, o.status, o.amount_due_vnd, o.created_at, o.paid_at, o.expires_at, c.title_vi, u.display_name, o.user_id
    FROM orders o JOIN order_items i ON i.order_id = o.id JOIN courses c ON c.id = i.course_id JOIN users u ON u.id = o.user_id
    WHERE (${input.status}::text IS NULL OR o.status = ${input.status})
      AND (${code}::text IS NULL OR o.code = ${code})
      AND (${after?.t ?? null}::timestamptz IS NULL OR (o.created_at, o.id) < (${after?.t ?? null}::timestamptz, ${after?.id ?? null}::uuid))
    ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    orders: page.map((o) => ({
      code: o.code, status: o.status, amountVnd: o.amount_due_vnd, createdAt: o.created_at, paidAt: o.paid_at, expiresAt: o.expires_at,
      course: o.title_vi, learner: o.display_name, userId: o.user_id,
    })),
    nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ t: last.created_at.toISOString(), id: last.id })).toString("base64url") : null,
  };
}
