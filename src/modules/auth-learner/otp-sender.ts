import { env } from "@/lib/env";
import type { OtpKind, OtpSender } from "@/modules/mail/contracts";
import { devMailbox } from "@/modules/mail/fake-sink";

export class ZaloDisabledError extends Error {
  constructor() {
    super("Đăng nhập bằng Zalo đang tắt");
  }
}

// Gửi mã qua Zalo ZNS. Chưa có OA và mẫu tin được duyệt (cổng G6) nên chưa có lời gọi mạng nào.
export class ZaloZnsSender implements OtpSender {
  async send(_kind: OtpKind, _valueCanonical: string, _code: string): Promise<void> {
    if (!env().ZALO_LOGIN_ENABLED) throw new ZaloDisabledError();
    throw new Error("Chưa cấu hình Zalo ZNS (chờ cổng G6)");
  }
}

/** Email: hộp thư giả trong bộ nhớ cho tới khi có nhà cung cấp email thật (cổng G7). Số điện thoại: Zalo ZNS. */
export function otpSenderFor(kind: OtpKind): OtpSender {
  return kind === "phone" ? new ZaloZnsSender() : devMailbox;
}
