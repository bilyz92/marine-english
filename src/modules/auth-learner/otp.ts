import { randomInt } from "node:crypto";
import { hmacHex } from "@/lib/crypto";
import { prisma, withTx, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import type { OtpKind, OtpSender } from "@/modules/mail/contracts";

export type { OtpKind } from "@/modules/mail/contracts";
export type OtpPurpose = "signup" | "login" | "link";

export type IssueInput = {
  purpose: OtpPurpose;
  kind: OtpKind;
  /** Định danh đã chuẩn hóa (+84… hoặc email chữ thường). */
  value: string;
  ip: string;
  /** Bắt buộc khi purpose = 'link'. */
  userId?: string;
  /** false: vẫn kiểm và tính hạn mức nhưng không tạo mã, không gửi (phản hồi trung tính). */
  create: boolean;
};

export type IssueResult = "sent" | "throttled" | "skipped" | "delivery_failed";

// Giới hạn tính theo định danh (kind, value), mọi purpose cộng chung.
const COOLDOWN = "60 seconds";
const PER_IDENTITY_PER_DAY = 10;
const PER_IP_PER_HOUR = 30;

export function otpHmac(keyVersion: string, purpose: OtpPurpose, kind: OtpKind, value: string, code: string): string | null {
  const pepper = env().OTP_PEPPERS.get(keyVersion);
  return pepper ? hmacHex(pepper, `${purpose}|${kind}|${value}|${code}`) : null;
}

async function isThrottled(tx: Tx, kind: OtpKind, value: string, ip: string): Promise<boolean> {
  const [c] = await tx.$queryRaw<{ recent: number; day: number; ip_hour: number }[]>`
    SELECT
      count(*) FILTER (WHERE kind = ${kind} AND value_canonical = ${value} AND sent_at > now() - ${COOLDOWN}::interval)::int AS recent,
      count(*) FILTER (WHERE kind = ${kind} AND value_canonical = ${value})::int AS day,
      count(*) FILTER (WHERE ip = ${ip}::inet AND sent_at > now() - interval '1 hour')::int AS ip_hour
    FROM otp_send_log
    WHERE sent_at > now() - interval '24 hours'
      AND ((kind = ${kind} AND value_canonical = ${value}) OR ip = ${ip}::inet)`;
  return c!.recent > 0 || c!.day >= PER_IDENTITY_PER_DAY || c!.ip_hour >= PER_IP_PER_HOUR;
}

/** Lấy một lượt trong ngân sách ZNS của ngày (giờ Việt Nam); hết ngân sách trả false. */
async function takeZnsBudget(tx: Tx): Promise<boolean> {
  await tx.$executeRaw`
    INSERT INTO zns_daily_budget (day, used) VALUES ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 0)
    ON CONFLICT (day) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ used: number }[]>`
    SELECT used FROM zns_daily_budget WHERE day = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date FOR UPDATE`;
  if (row!.used >= env().ZNS_DAILY_BUDGET) return false;
  await tx.$executeRaw`
    UPDATE zns_daily_budget SET used = used + 1 WHERE day = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
  return true;
}

type Issued = { status: "throttled" | "skipped" } | { status: "created"; challengeId: string; logId: string };

/**
 * Phát mã: khóa theo định danh rồi theo IP (luôn theo thứ tự này) → kiểm hạn mức → ngân sách ZNS → ghi nhật ký gửi
 * → hủy mã cũ → tạo mã mới → commit → sau commit mới gửi. Mã thô chỉ nằm trong bộ nhớ.
 */
export async function issueOtp(input: IssueInput, sender: OtpSender): Promise<IssueResult> {
  const { purpose, kind, value, ip, create } = input;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const keyVersion = env().OTP_PEPPER_CURRENT;

  const issued = await withTx(async (tx): Promise<Issued> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`otp-id:${kind}:${value}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`otp-ip:${ip}`}))`;
    if (await isThrottled(tx, kind, value, ip)) return { status: "throttled" };
    if (create && kind === "phone" && !(await takeZnsBudget(tx))) return { status: "throttled" };

    const [log] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO otp_send_log (kind, value_canonical, ip, channel, outcome)
      VALUES (${kind}, ${value}, ${ip}::inet, ${kind === "phone" ? "zns" : "email"}, ${create ? "sent" : "skipped"})
      RETURNING id`;
    if (!create) return { status: "skipped" };

    await tx.$executeRaw`
      UPDATE otp_challenges SET invalidated_at = now()
      WHERE kind = ${kind} AND value_canonical = ${value} AND consumed_at IS NULL AND invalidated_at IS NULL`;
    const [challenge] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO otp_challenges (purpose, kind, value_canonical, user_id, code_hmac, key_version, expires_at)
      VALUES (${purpose}, ${kind}, ${value}, ${input.userId ?? null}::uuid,
              ${otpHmac(keyVersion, purpose, kind, value, code)}, ${keyVersion}, now() + interval '5 minutes')
      RETURNING id`;
    return { status: "created", challengeId: challenge!.id, logId: log!.id };
  });

  if (issued.status !== "created") return issued.status;
  try {
    await sender.send(kind, value, code);
    return "sent";
  } catch {
    const db = prisma();
    await db.$executeRaw`UPDATE otp_challenges SET delivery_failed_at = now() WHERE id = ${issued.challengeId}::uuid`;
    await db.$executeRaw`UPDATE otp_send_log SET outcome = 'delivery_failed' WHERE id = ${issued.logId}::uuid`;
    return "delivery_failed";
  }
}
