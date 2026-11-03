import nodemailer from "nodemailer";
import type { AdminLinkSender, NoticeSender, OtpKind, OtpSender } from "./contracts";

// Gửi email thật qua SMTP. Chủ chọn Gmail (03/11/2026): smtp.gmail.com:465 với mật khẩu ứng dụng của tài khoản Google.

export type SmtpConfig = { host: string; port: number; user: string; password: string; fromName: string };
type Mail = { from: string; to: string; subject: string; text: string };
export type SmtpTransport = { sendMail(mail: Mail): Promise<unknown> };

const TIMEOUT_MS = 15_000;

/** Luôn mã hóa: 465 dùng TLS ngay, cổng khác bắt buộc STARTTLS (không gửi mật khẩu dạng rõ). */
export function transportOptions(c: SmtpConfig) {
  return {
    host: c.host, port: c.port, secure: c.port === 465, requireTLS: c.port !== 465, auth: { user: c.user, pass: c.password },
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
  };
}

function transportFor(c: SmtpConfig): SmtpTransport {
  return nodemailer.createTransport(transportOptions(c));
}

export function smtpSender(c: SmtpConfig, transport: SmtpTransport = transportFor(c)): OtpSender & AdminLinkSender & NoticeSender {
  const from = `"${c.fromName.replace(/"/g, "")}" <${c.user}>`;
  async function mail(to: string, subject: string, text: string): Promise<void> {
    try {
      await transport.sendMail({ from, to, subject, text });
    } catch {
      // Lỗi của máy chủ SMTP có thể chứa thông tin đăng nhập: chỉ lưu mã lỗi chung.
      throw new Error("smtp_failed");
    }
  }
  return {
    async send(kind: OtpKind, valueCanonical: string, code: string) {
      if (kind !== "email") throw new Error("smtp_email_only");
      await mail(valueCanonical, `Mã xác minh Marine English: ${code}`,
        `Mã xác minh Marine English của anh/chị: ${code}. Mã có hiệu lực 5 phút. Không đưa mã này cho ai.`);
    },
    async sendAdminLink(email: string, url: string) {
      await mail(email, "Đăng nhập trang quản trị Marine English",
        `Bấm link sau để đăng nhập trang quản trị (dùng một lần, hết hạn sau 15 phút):\n${url}\n\nNếu không phải anh/chị yêu cầu, bỏ qua thư này.`);
    },
    async sendNotice(email: string, subject: string, body: string) {
      await mail(email, subject, body);
    },
  };
}
