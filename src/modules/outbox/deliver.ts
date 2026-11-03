import { env } from "@/lib/env";
import { prisma, withTx } from "@/lib/db";
import { emailSender, EmailNotConfiguredError } from "@/modules/mail/email-sender";
import { emailMessage, telegramMessage } from "./messages";
import { enqueueOutbox } from "./outbox";
import { NotConfiguredError, telegramSender, type TelegramSender } from "./telegram";

export interface OutboxEmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}
export type Senders = { telegram: TelegramSender; email: OutboxEmailSender };
export type Claimed = { id: string; kind: string; channel: string; payload: Record<string, unknown>; attempts: number; claimToken: string };
export type DeliverStats = { sent: number; retried: number; dead: number; skipped: number };

/** Bộ gửi thật của worker. */
export function defaultSenders(): Senders {
  return {
    telegram: telegramSender(),
    email: { send: (to, subject, body) => emailSender().sendNotice(to, subject, body) },
  };
}

const MAX_ATTEMPTS = 8;
const NOT_CONFIGURED_RETRY_SECONDS = 300;
// Ngắn hơn hạn claim (2 phút): gửi chậm khi mạng kém thì trả phần còn lại, tránh worker khác lấy lại rồi gửi trùng.
const CLAIM_BUDGET_MS = 90_000;
/** Tin của nhóm lỗi: chết thì không sinh thêm cảnh báo (cùng kênh, cũng sẽ chết). */
export const ERROR_KINDS = new Set(["job_failed", "outbox_dead", "ledger_mismatch", "backup_alert", "ops_alert"]);

/** Nhận một lô tin đến hạn; tin đang gửi mà claim hết hạn (tiến trình gửi đã chết) được lấy lại. */
export async function claimBatch(limit = 20): Promise<Claimed[]> {
  return prisma().$queryRaw<Claimed[]>`
    WITH picked AS MATERIALIZED (
      SELECT id FROM outbox_events
      WHERE (status = 'pending' AND next_attempt_at <= now()) OR (status = 'sending' AND claimed_until < now())
      ORDER BY next_attempt_at, created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE outbox_events e
    SET status = 'sending', claim_token = gen_random_uuid(), claimed_until = now() + interval '2 minutes', attempts = e.attempts + 1
    FROM picked WHERE e.id = picked.id
    RETURNING e.id::text AS id, e.kind, e.channel, e.payload, e.attempts, e.claim_token::text AS "claimToken"`;
}

/** Ghi đã gửi nếu vẫn giữ claim; trả số dòng cập nhật (0 = claim đã bị lấy lại). */
export async function markSent(event: Claimed, note: string | null = null): Promise<number> {
  return prisma().$executeRaw`
    UPDATE outbox_events SET status = 'sent', sent_at = now(), claim_token = NULL, claimed_until = NULL, last_error = ${note}
    WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid`;
}

/** Trả tin về hàng đợi mà không tính lần thử này. */
function requeue(event: Claimed, note: string | null, delaySeconds: number) {
  return prisma().$executeRaw`
    UPDATE outbox_events
    SET status = 'pending', attempts = attempts - 1, claim_token = NULL, claimed_until = NULL, last_error = ${note},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid`;
}

function scheduleRetry(event: Claimed, error: string) {
  const delaySeconds = Math.min(2 ** event.attempts * 30, 3600);
  return prisma().$executeRaw`
    UPDATE outbox_events
    SET status = 'pending', claim_token = NULL, claimed_until = NULL, last_error = ${error},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid`;
}

/** Hết lượt thử → dead + một cảnh báo; tin của chính nhóm lỗi chết thì không sinh thêm cảnh báo. */
async function markDead(event: Claimed, error: string) {
  await withTx(async (tx) => {
    const n = await tx.$executeRaw`
      UPDATE outbox_events SET status = 'dead', claim_token = NULL, claimed_until = NULL, last_error = ${error}
      WHERE id = ${event.id}::uuid AND claim_token = ${event.claimToken}::uuid`;
    if (n === 0 || ERROR_KINDS.has(event.kind)) return;
    await enqueueOutbox(tx, {
      dedupKey: `outbox_dead:${event.id}`,
      kind: "outbox_dead",
      channel: "telegram",
      payload: { eventId: event.id, eventKind: event.kind, channel: event.channel, error },
    });
  });
}

/** Email của học viên; tài khoản đã gộp thì định danh nằm ở tài khoản đích nên tra ngược lên theo merged_into_id. */
async function learnerEmail(userId: string): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ email: string }[]>`
    WITH RECURSIVE up(id, merged_into_id) AS (
      SELECT id, merged_into_id FROM users WHERE id = ${userId}::uuid
      UNION
      SELECT u.id, u.merged_into_id FROM users u JOIN up ON u.id = up.merged_into_id
    )
    SELECT i.value_canonical AS email FROM up JOIN user_identities i ON i.user_id = up.id
    WHERE i.kind = 'email' ORDER BY i.verified_at DESC LIMIT 1`;
  return rows[0]?.email ?? null;
}

/** Gửi một tin; trả "no_email" nếu học viên không có địa chỉ để gửi. */
async function send(event: Claimed, senders: Senders): Promise<"sent" | "no_email"> {
  if (event.channel === "telegram") {
    const { chat, text, buttons } = telegramMessage(event.kind, event.payload, { origin: env().APP_ORIGIN });
    await senders.telegram.send(chat, text, buttons);
    return "sent";
  }
  const { subject, body } = emailMessage(event.kind, event.payload);
  const to = await learnerEmail(String(event.payload.userId));
  if (!to) return "no_email";
  await senders.email.send(to, subject, body);
  return "sent";
}

/** Giao hàng ít nhất một lần: nhận lô, gửi lần lượt, ghi kết quả theo claim. Lỗi gửi chỉ cập nhật outbox. */
export async function deliverBatch(senders: Senders, opts: { limit?: number; claimBudgetMs?: number } = {}): Promise<DeliverStats> {
  const stats: DeliverStats = { sent: 0, retried: 0, dead: 0, skipped: 0 };
  const deadline = Date.now() + (opts.claimBudgetMs ?? CLAIM_BUDGET_MS);
  for (const event of await claimBatch(opts.limit)) {
    if (Date.now() >= deadline) {
      await requeue(event, null, 0);
      stats.skipped++;
      continue;
    }
    try {
      const outcome = await send(event, senders);
      if (outcome === "no_email") {
        await markSent(event, "no_email");
        stats.skipped++;
      } else {
        await markSent(event);
        stats.sent++;
      }
    } catch (error) {
      if (error instanceof NotConfiguredError || error instanceof EmailNotConfiguredError) {
        await requeue(event, "not_configured", NOT_CONFIGURED_RETRY_SECONDS);
        stats.skipped++;
        continue;
      }
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (event.attempts >= MAX_ATTEMPTS) {
        await markDead(event, message);
        stats.dead++;
      } else {
        await scheduleRetry(event, message);
        stats.retried++;
      }
    }
  }
  return stats;
}
