import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTest } from "@/lib/env";
import { emailReady, emailSender } from "@/modules/mail/email-sender";
import { smtpSender, transportOptions } from "@/modules/mail/smtp-sender";

// Chủ chọn 03/11/2026: gửi email bằng Gmail (SMTP, mật khẩu ứng dụng).

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTest();
});

const config = { host: "smtp.gmail.com", port: 465, user: "marine@gmail.com", password: "abcdefghijklmnop", fromName: "Marine English" };

describe("bộ gửi SMTP (Gmail)", () => {
  it("thư thông báo, mã OTP, link quản trị: gửi từ tài khoản Gmail, văn bản thuần", async () => {
    const sent: Record<string, unknown>[] = [];
    const s = smtpSender(config, { sendMail: async (m) => { sent.push(m); } });
    await s.sendNotice("hv@x.vn", "Đơn ME1 đã thanh toán", "Nội dung");
    await s.send("email", "hv@x.vn", "123456");
    await s.sendAdminLink("chu@x.vn", "https://x.vn/admin#link=abc");
    expect(sent[0]).toEqual({ from: '"Marine English" <marine@gmail.com>', to: "hv@x.vn", subject: "Đơn ME1 đã thanh toán", text: "Nội dung" });
    expect(sent[1]).toMatchObject({ to: "hv@x.vn", text: expect.stringContaining("123456") });
    expect(sent[2]).toMatchObject({ to: "chu@x.vn", text: expect.stringContaining("https://x.vn/admin#link=abc") });
  });

  it("luôn mã hóa: 465 TLS ngay; 587 bắt buộc STARTTLS", () => {
    expect(transportOptions(config)).toMatchObject({ secure: true, requireTLS: false });
    expect(transportOptions({ ...config, port: 587 })).toMatchObject({ secure: false, requireTLS: true });
  });

  it("chỉ gửi email, không gửi tới số điện thoại", async () => {
    const s = smtpSender(config, { sendMail: async () => undefined });
    await expect(s.send("phone", "+84912345678", "123456")).rejects.toThrow();
  });

  it("lỗi SMTP không làm lộ mật khẩu trong thông báo lỗi", async () => {
    const s = smtpSender(config, { sendMail: async () => { throw new Error("Invalid login abcdefghijklmnop"); } });
    const error = await s.sendNotice("hv@x.vn", "a", "b").catch((e: Error) => e);
    expect((error as Error).message).toBe("smtp_failed");
  });

  it("production có SMTP_USER + SMTP_PASSWORD → dùng SMTP và coi email là sẵn sàng; thiếu → như cũ", () => {
    vi.stubEnv("NODE_ENV", "production");
    resetEnvForTest();
    expect(emailReady()).toBe(false);
    vi.stubEnv("SMTP_USER", "marine@gmail.com");
    vi.stubEnv("SMTP_PASSWORD", "abcd efgh ijkl mnop");
    resetEnvForTest();
    expect(emailReady()).toBe(true);
    expect(emailSender().constructor.name).not.toBe("FakeEmailSink");
  });
});
