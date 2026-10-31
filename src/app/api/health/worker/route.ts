import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Tín hiệu nhìn từ ngoài worker (cảnh báo do chính worker gửi nên không tự báo được khi nó chết):
 * 503 khi 2 phút không có lần gửi outbox nào, hoặc production chưa có kênh cảnh báo Telegram. Dịch vụ theo dõi bên ngoài gọi đường dẫn này [G8].
 */
export async function GET(request: Request): Promise<Response> {
  void request.headers;
  const headers = { "cache-control": "no-store" };
  if (process.env.NODE_ENV === "production" && (!env().TELEGRAM_BOT_TOKEN || !env().TELEGRAM_ERROR_CHAT_ID)) {
    return Response.json({ ok: false, reason: "alerts_not_configured" }, { status: 503, headers });
  }
  try {
    const [row] = await prisma().$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM job_runs WHERE job_name = 'me.outbox.deliver' AND started_at > now() - interval '2 minutes'`;
    if (row!.n === 0) return Response.json({ ok: false, reason: "worker_silent" }, { status: 503, headers });
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ ok: false, reason: "db" }, { status: 503, headers });
  }
}
