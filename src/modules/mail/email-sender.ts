import type { AdminLinkSender, NoticeSender, OtpSender } from "./contracts";
import { env } from "@/lib/env";
import { devMailbox } from "./fake-sink";
import { smtpSender } from "./smtp-sender";

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Chưa cấu hình nhà cung cấp email (chờ cổng G7)");
  }
}

// Production chưa có nhà cung cấp thật thì báo lỗi gửi (ghi delivery_failed), không giữ mã trong bộ nhớ tiến trình.
const unconfigured: OtpSender & AdminLinkSender & NoticeSender = {
  send: async () => {
    throw new EmailNotConfiguredError();
  },
  sendAdminLink: async () => {
    throw new EmailNotConfiguredError();
  },
  sendNotice: async () => {
    throw new EmailNotConfiguredError();
  },
};

let smtp: { key: string; sender: OtpSender & AdminLinkSender & NoticeSender } | null = null;

/** Bộ gửi email dùng chung: hộp thư giả ở dev/test; production gửi qua SMTP (G7: chủ chọn Gmail 03/11/2026), chưa cấu hình thì báo lỗi gửi. */
export function emailSender(): OtpSender & AdminLinkSender & NoticeSender {
  if (process.env.NODE_ENV !== "production") return devMailbox;
  const e = env();
  if (!e.SMTP_USER || !e.SMTP_PASSWORD) return unconfigured;
  const key = `${e.SMTP_HOST}:${e.SMTP_PORT}:${e.SMTP_USER}:${e.SMTP_PASSWORD}`;
  if (smtp?.key !== key) {
    smtp = { key, sender: smtpSender({ host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, password: e.SMTP_PASSWORD, fromName: e.EMAIL_FROM_NAME }) };
  }
  return smtp.sender;
}

/** Email có tới được người nhận không: production chưa cấu hình SMTP thì không. */
export function emailReady(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const e = env();
  return Boolean(e.SMTP_USER && e.SMTP_PASSWORD);
}
