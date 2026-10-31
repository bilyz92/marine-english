import { env } from "@/lib/env";

export type TelegramChat = "business" | "errors";

export interface TelegramSender {
  send(chat: TelegramChat, text: string): Promise<void>;
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
    async send(chat, text) {
      const chatId = chat === "business" ? config.businessChatId : config.errorChatId;
      if (!config.token || !chatId) throw new NotConfiguredError();
      let res: Response;
      try {
        res = await fetchFn(`https://api.telegram.org/bot${config.token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new Error("telegram_network");
      }
      if (!res.ok) throw new Error(`telegram_http_${res.status}`);
    },
  };
}
