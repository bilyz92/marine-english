import type { TelegramButton, TelegramChat } from "./telegram";

type Payload = Record<string, unknown>;
type Ctx = { origin?: string };
type TelegramMsg = { chat: TelegramChat; text: string; buttons?: TelegramButton[][] };

/** Nút "Đã thấy tiền" / "Không thấy tiền" (bot hỏi xác nhận trước khi làm), kèm link mở thẳng đơn trên trang quản trị. */
export function reviewButtons(code: string): TelegramButton[] {
  return [{ text: "✅ Đã thấy tiền", callback: `a:${code}` }, { text: "❌ Không thấy tiền", callback: `r:${code}` }];
}
export const orderLink = (code: string, origin?: string): TelegramButton[][] =>
  origin ? [[{ text: "Mở đơn trên web", url: `${origin}/admin/don-hang?q=${encodeURIComponent(code)}` }]] : [];
const review = (p: Payload, ctx: Ctx) => [reviewButtons(String(p.orderCode)), ...orderLink(String(p.orderCode), ctx.origin)];

const vnd = (value: unknown) => `${Number(value).toLocaleString("vi-VN")}đ`;
const courseList = (p: Payload) => (Array.isArray(p.courses) && p.courses.length ? p.courses.join(", ") : null);
const vnTime = (iso: unknown) =>
  new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric", hour12: false })
    .formatToParts(new Date(String(iso)))
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});

/** Sự kiện cũ (trước 01/11) không có khóa, giờ: chỉ hiện phần có. */
function paidText(p: Payload): string {
  const t = p.paidAt ? vnTime(p.paidAt) : null;
  const parts = [courseList(p), vnd(p.amountVnd), t ? `lúc ${t.hour}:${t.minute} ${t.day}/${t.month}/${t.year}` : null].filter(Boolean);
  return `Đơn ${p.orderCode} đã thanh toán: ${parts.join(", ")}.`;
}

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
const TELEGRAM: Record<string, (p: Payload, ctx: Ctx) => TelegramMsg> = {
  order_paid: (p) => ({ chat: "business", text: paidText(p) }),
  refund_requested: (p) => ({ chat: "business", text: `Học viên yêu cầu hoàn tiền đơn ${p.orderCode}: ${vnd(p.amountVnd)}. Xem trang Hoàn tiền.` }),
  order_refunded: (p) => ({ chat: "business", text: `Đơn ${p.orderCode} đã hoàn tiền: ${vnd(p.amountVnd)}.` }),
  transfer_claimed: (p, ctx) => ({
    chat: "business",
    text: `Khách báo đã chuyển khoản đơn ${p.orderCode}: ${vnd(p.amountVnd)}${courseList(p) ? `, khóa ${courseList(p)}` : ""}. Khóa học đã mở tạm; kiểm sao kê rồi bấm Đã thấy tiền hoặc Không thấy tiền.`,
    buttons: review(p, ctx),
  }),
  transfer_proof: (p, ctx) => ({
    chat: "business",
    text: `Khách gửi ảnh chứng minh chuyển khoản cho đơn ${p.orderCode} (${vnd(p.amountVnd)}). Xem ảnh ở trang Đơn hàng.`,
    buttons: review(p, ctx),
  }),
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
      : p.reason === "prune_skipped"
        ? `Có bản sao lưu với manifest hỏng trong thư mục db/: đã ngừng dọn bản cũ để không mất dữ liệu. Kiểm tra và gỡ bản hỏng bằng tay.`
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
    body: `Marine English đã nhận ${vnd(p.amountVnd)} cho đơn ${p.orderCode}${courseList(p) ? ` (khóa ${courseList(p)})` : ""}. `
      + `Khóa học đã mở, anh/chị vào ${p.learnUrl ? `${p.learnUrl}` : "mục Học"} để bắt đầu.`,
  }),
  refund_cancelled: (p) => ({
    subject: `Yêu cầu hoàn tiền đơn ${p.orderCode} không được chấp nhận`,
    body: `Marine English đã xem yêu cầu hoàn tiền đơn ${p.orderCode} và không chấp nhận. Lý do: ${p.reason}. Khóa học vẫn mở như cũ.`,
  }),
  transfer_claim_rejected: (p) => ({
    subject: `Khóa học của đơn ${p.orderCode} tạm khóa: tiền chưa được xác nhận`,
    body: `Marine English chưa thấy khoản chuyển cho đơn ${p.orderCode} nên khóa học đã tạm khóa. Tiền chưa được xác nhận. Lý do: ${p.reason}\n\n`
      + `Nếu anh/chị đã chuyển khoản, mở ${p.payUrl} và gửi ảnh chụp màn hình giao dịch. Chủ khóa học sẽ kiểm tra và mở lại khóa học khi thấy tiền.`,
  }),
  order_refunded: (p) => ({
    subject: `Đơn ${p.orderCode} đã hoàn tiền`,
    body: `Marine English đã hoàn ${vnd(p.amountVnd)} cho đơn ${p.orderCode}. Khóa học của đơn này đã đóng; tiến độ học vẫn được giữ nếu anh/chị mua lại.`,
  }),
};

function render<T>(table: Record<string, (p: Payload, ctx: Ctx) => T>, kind: string, payload: Payload, ctx: Ctx = {}): T {
  const build = table[kind];
  if (!build) throw new Error(`unknown_kind:${kind}`);
  return build(payload, ctx);
}

export const telegramMessage = (kind: string, payload: Payload, ctx: Ctx = {}) => render(TELEGRAM, kind, payload, ctx);
export const emailMessage = (kind: string, payload: Payload) => render(EMAIL, kind, payload);
