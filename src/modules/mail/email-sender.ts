import type { AdminLinkSender, NoticeSender, OtpSender } from "./contracts";
import { devMailbox } from "./fake-sink";

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

/** Bộ gửi email dùng chung: hộp thư giả ở dev/test, báo lỗi ở production cho tới khi G7 chọn nhà cung cấp. */
export function emailSender(): OtpSender & AdminLinkSender & NoticeSender {
  return process.env.NODE_ENV === "production" ? unconfigured : devMailbox;
}

/** Email có tới được người nhận không: production chưa có nhà cung cấp (G7) thì không. */
export function emailReady(): boolean {
  return process.env.NODE_ENV !== "production";
}
