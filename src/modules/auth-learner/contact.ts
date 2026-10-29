import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { canonicalizeEmail } from "@/modules/identity/email";
import { canonicalizeVnPhone } from "@/modules/identity/phone";
import type { OtpKind } from "@/modules/mail/contracts";

/** Nhận email hoặc số di động Việt Nam; số điện thoại chỉ nhận khi đã bật đăng nhập Zalo. */
export function parseContact(contact: string): { kind: OtpKind; value: string } {
  if (contact.includes("@")) {
    const value = canonicalizeEmail(contact);
    if (value) return { kind: "email", value };
    throw new HttpError(400, "Email không hợp lệ");
  }
  if (!env().ZALO_LOGIN_ENABLED) throw new HttpError(400, "Đăng nhập bằng số điện thoại qua Zalo sẽ mở sau");
  const value = canonicalizeVnPhone(contact);
  if (value) return { kind: "phone", value };
  throw new HttpError(400, "Số điện thoại không hợp lệ");
}
