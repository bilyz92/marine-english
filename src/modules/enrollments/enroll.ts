import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { enqueueOutbox } from "@/modules/outbox/outbox";

/**
 * Ghi nhận đơn đã được thanh toán bằng các dòng sổ (đã khóa, đã xác minh, chưa xử lý): phân bổ toàn bộ tiền từng dòng,
 * đơn → paid, quyền học cho mọi khóa của đơn, sự kiện thông báo. Người gọi đã khóa dòng sổ rồi tới đơn.
 */
export async function settleOrder(
  tx: Tx,
  input: { orderId: string; bankTransactionIds: string[]; kind: "auto" | "manual"; allocatedBy?: string },
): Promise<void> {
  for (const btId of input.bankTransactionIds) {
    await tx.$executeRaw`
      INSERT INTO payment_allocations (bank_transaction_id, order_id, amount_vnd, kind, allocated_by)
      SELECT id, ${input.orderId}::uuid, amount_vnd, ${input.kind}, ${input.allocatedBy ?? null}::uuid
      FROM bank_transactions WHERE id = ${btId}::uuid`;
  }
  const [order] = await tx.$queryRaw<{ code: string; user_id: string; amount_due_vnd: number; paid_at: Date }[]>`
    UPDATE orders SET status = 'paid', paid_at = now() WHERE id = ${input.orderId}::uuid
    RETURNING code, user_id, amount_due_vnd, paid_at`;
  await tx.$executeRaw`
    INSERT INTO enrollments (user_id, course_id, source, order_id)
    SELECT o.user_id, i.course_id, 'order', o.id FROM orders o JOIN order_items i ON i.order_id = o.id
    WHERE o.id = ${input.orderId}::uuid
    ON CONFLICT (order_id, course_id) DO NOTHING`;
  const courses = await tx.$queryRaw<{ title_vi: string }[]>`
    SELECT c.title_vi FROM order_items i JOIN courses c ON c.id = i.course_id WHERE i.order_id = ${input.orderId}::uuid ORDER BY c.title_vi`;
  // US-08 / US-04: tin có tên khóa và giờ thanh toán; email có link vào app. Không đưa danh tính khách vào tin (NFR-10).
  const payload = {
    orderId: input.orderId, orderCode: order!.code, userId: order!.user_id, amountVnd: order!.amount_due_vnd,
    courses: courses.map((c) => c.title_vi), paidAt: order!.paid_at.toISOString(), learnUrl: new URL("/hoc", env().APP_ORIGIN).toString(),
  };
  for (const channel of ["telegram", "email"] as const) {
    await enqueueOutbox(tx, { dedupKey: `order_paid:${input.orderId}:${channel}`, kind: "order_paid", channel, payload });
  }
}
