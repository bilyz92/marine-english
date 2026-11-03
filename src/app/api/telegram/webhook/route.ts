import { env } from "@/lib/env";
import { clientIp, json } from "@/lib/http";
import { handleCallback, telegramSecretOk } from "@/modules/orders/telegram-review";

// Telegram gửi lần bấm nút trong tin báo (chỉ đăng ký callback_query). Xác thực bằng mã bí mật trong header.
const MAX_BODY_BYTES = 65_536;

export async function POST(req: Request): Promise<Response> {
  if (!env().TELEGRAM_WEBHOOK_SECRET || !env().TELEGRAM_BOT_TOKEN) return json({ error: "Chưa cấu hình" }, { status: 503 });
  if (!telegramSecretOk(req.headers.get("x-telegram-bot-api-secret-token"))) return json({ error: "Không xác thực được" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Body quá lớn" }, { status: 413 });
  let update: { callback_query?: Parameters<typeof handleCallback>[0] };
  try {
    update = JSON.parse(raw);
  } catch {
    return json({ error: "Body không hợp lệ" }, { status: 400 });
  }
  if (update.callback_query?.id) {
    try {
      await handleCallback(update.callback_query, clientIp(req));
    } catch (error) {
      // Trả 200 để Telegram không gửi lại một lần bấm cũ; chủ bấm lại hoặc duyệt trên web.
      console.error("telegram_callback_failed", { message: (error as Error).message });
    }
  }
  return json({ ok: true });
}
