// Bộ phân loại giao dịch (thuần, có phiên bản). Mọi nguồn tiền vào dùng chung; thời điểm quyết định là bank_time.
// Chỉ tự xác nhận khi: đúng một mã đơn, đúng số tiền, created_at <= bank_time < expires_at, đơn pending hoặc expired.

export const CLASSIFIER_VERSION = "v1";

export type OrderStatus = "pending" | "paid" | "expired" | "refunded";
export type QueueReason =
  | "no_code" | "multi_code" | "unknown_code" | "amount_short" | "amount_over"
  | "late" | "early" | "order_paid" | "order_refunded" | "bad_time";
export type Classification = { result: "auto_confirm" } | { result: "queue"; reason: QueueReason };

const CODE_PATTERN = /(?<![A-Z0-9])ME[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}(?![A-Z0-9])/g;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Chuẩn hóa nội dung (bỏ dấu, chữ hoa, ký tự khác chữ/số thành khoảng trắng) rồi lấy các mã đơn đứng riêng, không trùng. */
export function extractOrderCodes(content: string): string[] {
  const normalized = content
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ");
  return [...new Set(normalized.match(CODE_PATTERN) ?? [])];
}

export function classify(input: {
  amountVnd: number;
  bankTime: Date;
  now: Date;
  codes: string[];
  order: { id: string; status: OrderStatus; amountDueVnd: number; createdAt: Date; expiresAt: Date } | null;
}): Classification {
  const queue = (reason: QueueReason): Classification => ({ result: "queue", reason });
  const { amountVnd, bankTime, now, codes, order } = input;
  if (bankTime.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return queue("bad_time");
  if (codes.length === 0) return queue("no_code");
  if (codes.length > 1) return queue("multi_code");
  if (!order) return queue("unknown_code");
  if (order.status === "paid") return queue("order_paid");
  if (order.status === "refunded") return queue("order_refunded");
  if (bankTime < order.createdAt) return queue("early");
  if (bankTime >= order.expiresAt) return queue("late");
  if (amountVnd < order.amountDueVnd) return queue("amount_short");
  if (amountVnd > order.amountDueVnd) return queue("amount_over");
  return { result: "auto_confirm" };
}
