import type { TelegramChat } from "./telegram";

type Payload = Record<string, unknown>;

const vnd = (value: unknown) => `${Number(value).toLocaleString("vi-VN")}đ`;

function opsAlertText(p: Payload): string {
  const type = String(p.type);
  if (type === "disk_70" || type === "disk_85") return `Ổ đĩa máy chủ đã dùng ${p.percent}%.`;
  if (type === "app_down") return "Trang web không trả lời kiểm tra sức khỏe.";
  if (type === "cert_expiring") return `Chứng chỉ HTTPS còn ${p.days} ngày.`;
  if (type === "backup_stale") return "Quá 26 giờ không có bản sao lưu thành công.";
  if (type === "outbox_stuck") return `${p.count} thông báo chờ gửi quá 30 phút.`;
  if (type === "outbox_dead") return `${p.count} thông báo đã ngừng thử gửi.`;
  if (type.startsWith("job_stuck:")) return `Job ${p.job} không hoàn thành trong 3 chu kỳ liên tiếp.`;
  if (type.startsWith("job_missed:")) return `Job ${p.job} lỡ lịch quá 1 giờ.`;
  return `Cảnh báo vận hành: ${type}`;
}

// Chỉ dùng các trường liệt kê ở đây: không đưa nội dung chuyển khoản, số tài khoản, mã OTP hay token vào tin.
const TELEGRAM: Record<string, (p: Payload) => { chat: TelegramChat; text: string }> = {
  order_paid: (p) => ({ chat: "business", text: `Đơn ${p.orderCode} đã thanh toán: ${vnd(p.amountVnd)}.` }),
  order_refunded: (p) => ({ chat: "business", text: `Đơn ${p.orderCode} đã hoàn tiền: ${vnd(p.amountVnd)}.` }),
  ledger_queued: (p) => ({
    chat: "business",
    text: `Có khoản chuyển cần xử lý tay: ${vnd(p.amountVnd)}, lý do ${p.reason}${p.orderCode ? `, đơn ${p.orderCode}` : ""}.`,
  }),
  ledger_mismatch: (p) => ({
    chat: "errors",
    text: `Giao dịch ${p.bankTransactionId} bị báo khác sổ (${p.source}): báo ${vnd(p.reportedAmountVnd)}, sổ ghi ${vnd(p.ledgerAmountVnd)}.`,
  }),
  job_failed: (p) => ({ chat: "errors", text: `Job ${p.job} ${p.status === "timeout" ? "quá giờ" : "lỗi"}: ${p.error}` }),
  outbox_dead: (p) => ({ chat: "errors", text: `Không gửi được thông báo ${p.eventKind} qua ${p.channel}, đã dừng thử lại: ${p.error}` }),
  backup_alert: (p) => ({
    chat: "errors",
    text: p.reason === "no_offsite"
      ? `Sao lưu ${p.day} chỉ nằm trên máy chủ: chưa cấu hình nơi lưu ngoài (BACKUP_RCLONE_REMOTE).`
      : p.reason === "offsite_failed"
        ? `Sao lưu ${p.day} có trên máy chủ nhưng đẩy ra nơi lưu ngoài lỗi: ${p.error}`
      : p.reason === "missing_key"
        ? `Thiếu tệp khóa sao lưu ${(p.keys as string[]).join(", ")} của bản còn giữ: không mở được các bản đó.`
        : `Sao lưu ${p.day} không chạy: chưa cấu hình (BACKUP_*).`,
  }),
  ops_alert: (p) => ({ chat: "errors", text: opsAlertText(p) }),
  daily_summary: (p) => ({
    chat: "business",
    text: `Tổng kết ${p.day}: ${p.paidOrders} đơn đã thanh toán, doanh thu ${vnd(p.revenueVnd)}, ${p.refunds} lần hoàn tiền, ${p.queueOpen} khoản chờ xử lý tay, ${p.outboxDead} thông báo gửi hỏng.`,
  }),
};

const EMAIL: Record<string, (p: Payload) => { subject: string; body: string }> = {
  order_paid: (p) => ({
    subject: `Đơn ${p.orderCode} đã thanh toán`,
    body: `Marine English đã nhận ${vnd(p.amountVnd)} cho đơn ${p.orderCode}. Khóa học đã mở, anh/chị vào mục Học để bắt đầu.`,
  }),
  order_refunded: (p) => ({
    subject: `Đơn ${p.orderCode} đã hoàn tiền`,
    body: `Marine English đã hoàn ${vnd(p.amountVnd)} cho đơn ${p.orderCode}. Khóa học của đơn này đã đóng; tiến độ học vẫn được giữ nếu anh/chị mua lại.`,
  }),
};

function render<T>(table: Record<string, (p: Payload) => T>, kind: string, payload: Payload): T {
  const build = table[kind];
  if (!build) throw new Error(`unknown_kind:${kind}`);
  return build(payload);
}

export const telegramMessage = (kind: string, payload: Payload) => render(TELEGRAM, kind, payload);
export const emailMessage = (kind: string, payload: Payload) => render(EMAIL, kind, payload);
