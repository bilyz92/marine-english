import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { orderLink, reviewButtons } from "@/modules/outbox/messages";
import { inlineKeyboard, telegramCall, type TelegramButton } from "@/modules/outbox/telegram";
import type { AdminCtx } from "@/modules/sessions/guards";
import { approveTransfer, rejectClaim } from "./claims";

// Chủ chọn 03/11/2026: duyệt hoặc khóa lại ngay trên Telegram. Bấm "Đã nhận"/"Chưa nhận" chỉ hỏi lại;
// "Chắc chắn" mới làm, qua đúng approveTransfer/rejectClaim như trang quản trị (chỉ chủ, có nhật ký).
// Giờ chuyển ghi là lúc bấm (chủ đã chấp nhận); muốn đúng giờ sao kê thì duyệt trên web.

export const TELEGRAM_REJECT_REASON = "Sao kê chưa thấy khoản chuyển cho đơn này.";
const CODE = /^([arARx]):(ME[A-Z0-9]{8})$/;

type CallbackQuery = {
  id: string;
  from?: { id?: number };
  data?: string;
  message?: {
    message_id?: number;
    /** Giờ gửi tin (giây Unix). */
    date?: number;
    chat?: { id?: number | string };
    text?: string;
    reply_markup?: { inline_keyboard?: { callback_data?: string }[][] };
  };
};

/** Telegram gửi kèm bàn phím hiện tại của tin: nút vừa bấm phải đang có trên tin (không bỏ qua được bước hỏi lại). */
function onMessage(q: CallbackQuery): boolean {
  return (q.message?.reply_markup?.inline_keyboard ?? []).some((row) => row.some((b) => b.callback_data === q.data));
}

export function telegramSecretOk(header: string | null): boolean {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Người bấm → tài khoản chủ đang hoạt động; không có thì null. */
async function ownerFor(telegramUserId: number | undefined, ip: string): Promise<AdminCtx | null> {
  const email = telegramUserId === undefined ? undefined : env().TELEGRAM_APPROVERS.get(String(telegramUserId));
  if (!email) return null;
  const admin = await prisma().adminUser.findUnique({ where: { emailLower: email }, select: { id: true, role: true, status: true } });
  if (!admin || admin.role !== "owner" || admin.status !== "active") return null;
  return { adminId: admin.id, role: admin.role, sessionId: "telegram", authAt: new Date(), ip };
}

const answer = (q: CallbackQuery, text?: string) => telegramCall("answerCallbackQuery", { callback_query_id: q.id, ...(text && { text }) });

const APPROVE_TEXT: Record<string, string> = {
  paid: "✅ Đã duyệt: đơn đã thanh toán, khóa học mở hẳn.",
  order_paid: "Đơn này đã thanh toán trước đó, không duyệt lại.",
  order_refunded: "Đơn này đã hoàn tiền, không duyệt được.",
  not_found: "Không tìm thấy đơn.",
  ref_used: "Mã giao dịch đã dùng cho đơn khác.",
};
const REJECT_TEXT: Record<string, string> = {
  revoked: "❌ Đã khóa lại khóa học. Khách thấy lý do và gửi được ảnh chứng minh.",
  not_claimed: "Đơn này không còn mở tạm (đã khóa hoặc đã thanh toán).",
  not_found: "Không tìm thấy đơn.",
};

/** Đơn đã bị khóa lại sau lúc tin được gửi (hoặc không biết giờ gửi). */
async function rejectedSince(code: string, sentAt: number | undefined): Promise<boolean> {
  const [row] = await prisma().$queryRaw<{ at: Date | null }[]>`
    SELECT max(r.created_at) AS at FROM transfer_claim_rejections r JOIN orders o ON o.id = r.order_id WHERE o.code = ${code}`;
  if (!row?.at) return false;
  return sentAt === undefined || row.at.getTime() >= sentAt * 1000;
}

/** Xử lý một lần bấm nút. Lỗi gọi Telegram không làm hỏng thao tác đã ghi. */
export async function handleCallback(q: CallbackQuery, ip: string): Promise<void> {
  const chatId = q.message?.chat?.id;
  const messageId = q.message?.message_id;
  const m = CODE.exec(q.data ?? "");
  const owner = String(chatId) === env().TELEGRAM_BUSINESS_CHAT_ID && m && messageId ? await ownerFor(q.from?.id, ip) : null;
  if (!owner || !m) return answer(q, "Không có quyền.");
  if (!onMessage(q)) return answer(q, "Nút đã cũ, mở lại tin.");
  const [, step, code] = m as unknown as [string, string, string];
  const where = { chat_id: String(chatId), message_id: messageId };

  if (step === "a" || step === "r" || step === "x") {
    const first: TelegramButton[] = step === "x"
      ? reviewButtons(code)
      : [
          step === "a" ? { text: `Chắc chắn đã nhận tiền ${code}`, callback: `A:${code}` } : { text: `Chắc chắn chưa nhận, khóa lại ${code}`, callback: `R:${code}` },
          { text: "Thôi", callback: `x:${code}` },
        ];
    const buttons = [first, ...orderLink(code, env().APP_ORIGIN)];
    await telegramCall("editMessageReplyMarkup", { ...where, reply_markup: inlineKeyboard(buttons) });
    return answer(q);
  }

  let line: string;
  if (step === "A") {
    const r = await approveTransfer(owner, { orderCode: code, bankRef: "", note: "Duyệt qua Telegram", bankTime: new Date() });
    line = APPROVE_TEXT[r.result === "paid" ? "paid" : r.reason]!;
  } else if (await rejectedSince(code, q.message?.date)) {
    // Tin gửi trước lần khóa gần nhất (vd sửa tin lỗi nên nút còn): không khóa lại theo tin cũ khi có thể đã có ảnh mới.
    return answer(q, "Tin đã cũ, xem tin mới hơn.");
  } else {
    line = REJECT_TEXT[await rejectClaim(owner, { orderCode: code, reason: TELEGRAM_REJECT_REASON })]!;
  }
  try {
    await telegramCall("editMessageText", {
      ...where, text: `${q.message?.text ?? ""}\n\n${line}`, reply_markup: inlineKeyboard(orderLink(code, env().APP_ORIGIN)),
    });
  } finally {
    await answer(q, line).catch(() => undefined);
  }
}
