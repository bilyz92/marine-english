import { afterEach, describe, expect, it, vi } from "vitest";
import { emailSender, EmailNotConfiguredError } from "@/modules/mail/email-sender";
import { devMailbox, FakeEmailSink } from "@/modules/mail/fake-sink";
import { otpSenderFor } from "@/modules/auth-learner/otp-sender";

afterEach(() => vi.unstubAllEnvs());

describe("bộ gửi email", () => {
  it("dev/test dùng hộp thư giả", () => {
    expect(emailSender()).toBe(devMailbox);
    expect(otpSenderFor("email")).toBe(devMailbox);
  });

  it("thư thông báo: dev vào hộp thư giả, production báo chưa cấu hình", async () => {
    await emailSender().sendNotice("tb@x.vn", "Chủ đề", "Nội dung");
    expect(devMailbox.messages().at(-1)).toMatchObject({ to: "tb@x.vn", kind: "notice", body: "Chủ đề\n\nNội dung" });
    vi.stubEnv("NODE_ENV", "production");
    await expect(emailSender().sendNotice("tb@x.vn", "c", "n")).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });

  it("production chưa có nhà cung cấp email (G7) → báo lỗi gửi, không giữ mã trong bộ nhớ", async () => {
    vi.stubEnv("NODE_ENV", "production");
    devMailbox.clear();
    await expect(emailSender().send("email", "a@x.vn", "123456")).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(otpSenderFor("email").send("email", "a@x.vn", "123456")).rejects.toBeInstanceOf(EmailNotConfiguredError);
    await expect(emailSender().sendAdminLink("a@x.vn", "https://x")).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(devMailbox.messages()).toHaveLength(0);
  });

  it("hộp thư giả chỉ giữ 200 thư mới nhất", async () => {
    const sink = new FakeEmailSink();
    for (let i = 0; i < 205; i++) await sink.send("email", `u${i}@x.vn`, "000000");
    expect(sink.messages()).toHaveLength(200);
    expect(sink.messages()[0]!.to).toBe("u5@x.vn");
  });
});
