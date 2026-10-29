export type OtpKind = "email" | "phone";

/** Gửi mã OTP thô tới định danh; chỉ gọi sau khi transaction phát mã đã commit. */
export interface OtpSender {
  send(kind: OtpKind, valueCanonical: string, code: string): Promise<void>;
}

/** Gửi link đăng nhập khu vực quản trị. */
export interface AdminLinkSender {
  sendAdminLink(email: string, url: string): Promise<void>;
}
