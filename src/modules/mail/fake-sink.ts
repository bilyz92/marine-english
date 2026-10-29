import type { AdminLinkSender, OtpKind, OtpSender } from "./contracts";

export type FakeMessage = { to: string; kind: "otp" | "admin_link"; body: string };

// Bộ gửi giả cho dev/test: chỉ giữ thư trong bộ nhớ, không ghi log (thư chứa mã thô).
export class FakeEmailSink implements OtpSender, AdminLinkSender {
  private inbox: FakeMessage[] = [];

  async send(_kind: OtpKind, valueCanonical: string, code: string): Promise<void> {
    this.inbox.push({ to: valueCanonical, kind: "otp", body: `Mã xác minh Marine English của anh/chị: ${code}. Mã có hiệu lực 5 phút.` });
  }

  async sendAdminLink(email: string, url: string): Promise<void> {
    this.inbox.push({ to: email, kind: "admin_link", body: url });
  }

  messages(): FakeMessage[] {
    return [...this.inbox];
  }

  clear(): void {
    this.inbox = [];
  }
}

// Hộp thư dùng chung trong tiến trình (route và trang /dev/thu nằm ở các bundle khác nhau nên gắn vào globalThis).
const holder = globalThis as typeof globalThis & { __meDevMailbox?: FakeEmailSink };
export const devMailbox: FakeEmailSink = (holder.__meDevMailbox ??= new FakeEmailSink());
