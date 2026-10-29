import type { OtpKind } from "@/modules/auth-learner/otp";
import type { OtpSender } from "@/modules/mail/contracts";
import { pgAs } from "./pg";

export async function sqlAsMigrator(query: string, params: unknown[] = []) {
  const client = await pgAs("migrator");
  try {
    return await client.query(query, params);
  } finally {
    await client.end();
  }
}

/** Lùi sent_at của mọi dòng otp_send_log đi ms mili giây (giả lập thời gian trôi). */
export async function ageSendLog(ms: number) {
  await sqlAsMigrator(`UPDATE otp_send_log SET sent_at = sent_at - make_interval(secs => $1::double precision / 1000)`, [ms]);
}

export class FailingSender implements OtpSender {
  calls = 0;
  async send(_kind: OtpKind, _value: string, _code: string): Promise<void> {
    this.calls += 1;
    throw new Error("nhà cung cấp lỗi");
  }
}
