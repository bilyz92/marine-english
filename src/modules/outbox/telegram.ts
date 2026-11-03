import { env } from "@/lib/env";

export type TelegramChat = "business" | "errors";

/** Nút trong tin: callback (bot nhận khi bấm) hoặc link. */
export type TelegramButton = { text: string; callback: string } | { text: string; url: string };

export interface TelegramSender {
  send(chat: TelegramChat, text: string, buttons?: TelegramButton[][]): Promise<void>;
}

export function inlineKeyboard(buttons: TelegramButton[][]) {
  return { inline_keyboard: buttons.map((row) => row.map((b) => ("url" in b ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callback }))) };
}

export type TelegramConfig = { token?: string; businessChatId?: string; errorChatId?: string };

const TIMEOUT_MS = 10_000;

export class NotConfiguredError extends Error {
  constructor() {
    super("not_configured");
    this.name = "NotConfiguredError";
  }
}

function configFromEnv(): TelegramConfig {
  const e = env();
  return { token: e.TELEGRAM_BOT_TOKEN, businessChatId: e.TELEGRAM_BUSINESS_CHAT_ID, errorChatId: e.TELEGRAM_ERROR_CHAT_ID };
}

/** Bộ gửi Telegram Bot API. Thông báo lỗi không kèm URL vì URL chứa token (last_error được lưu vào DB). */
export function telegramSender(config: TelegramConfig = configFromEnv(), fetchFn: typeof fetch = fetch): TelegramSender {
  return {
    async send(chat, text, buttons) {
      const chatId = chat === "business" ? config.businessChatId : config.errorChatId;
      if (!config.token || !chatId) throw new NotConfiguredError();
      let res: Response;
      try {
        res = await fetchFn(`https://api.telegram.org/bot${config.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, ...(buttons?.length && { reply_markup: inlineKeyboard(buttons) }) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new Error("telegram_network");
      }
      if (!res.ok) throw new Error(`telegram_http_${res.status}`);
    },
  };
}

/** Gọi một phương thức Bot API (trả lời nút bấm, sửa tin). Lỗi không kèm URL vì URL chứa token. */
export async function telegramCall(method: string, body: Record<string, unknown>, token = env().TELEGRAM_BOT_TOKEN): Promise<void> {
  if (!token) throw new NotConfiguredError();
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new Error("telegram_network");
  }
  if (!res.ok) throw new Error(`telegram_http_${res.status}`);
}
