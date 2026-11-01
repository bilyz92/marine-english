import { describe, expect, it, vi } from "vitest";
import { emailMessage, telegramMessage } from "@/modules/outbox/messages";
import { NotConfiguredError, telegramSender } from "@/modules/outbox/telegram";

describe("nội dung tin", () => {
  it("đơn đã thanh toán: Telegram vào nhóm kinh doanh (mã, khóa, số tiền, giờ VN; không danh tính), email có khóa và link vào app", () => {
    const payload = {
      orderId: "o1", orderCode: "ME7K3QX9AB", userId: "u1", amountVnd: 199000,
      courses: ["Engine Cadet — Tàu dầu"], paidAt: "2026-11-01T02:05:00.000Z", learnUrl: "https://example.vn/hoc",
    };
    const t = telegramMessage("order_paid", payload);
    expect(t.chat).toBe("business");
    expect(t.text).toBe("Đơn ME7K3QX9AB đã thanh toán: Engine Cadet — Tàu dầu, 199.000đ, lúc 09:05 01/11/2026.");
    expect(t.text).not.toContain("u1");
    const e = emailMessage("order_paid", payload);
    expect(e.subject).toContain("ME7K3QX9AB");
    expect(e.body).toContain("Engine Cadet — Tàu dầu");
    expect(e.body).toContain("199.000đ");
    expect(e.body).toContain("https://example.vn/hoc");
  });

  it("sự kiện đơn đã thanh toán cũ (chưa có khóa, giờ, link) vẫn hiện được", () => {
    const payload = { orderId: "o1", orderCode: "ME7K3QX9AB", userId: "u1", amountVnd: 199000 };
    expect(telegramMessage("order_paid", payload).text).toBe("Đơn ME7K3QX9AB đã thanh toán: 199.000đ.");
    expect(emailMessage("order_paid", payload).body).toContain("ME7K3QX9AB");
  });

  it("yêu cầu hoàn tiền bị từ chối: email nêu mã đơn và lý do", () => {
    const e = emailMessage("refund_cancelled", { orderCode: "ME7K3QX9AB", userId: "u1", reason: "đã học quá nửa khóa" });
    expect(e.subject).toContain("ME7K3QX9AB");
    expect(e.body).toContain("đã học quá nửa khóa");
  });

  it("cảnh báo lỗi đi nhóm lỗi; tổng kết đi nhóm kinh doanh", () => {
    expect(telegramMessage("job_failed", { job: "me.x", status: "failed", error: "hỏng" }).chat).toBe("errors");
    expect(telegramMessage("outbox_dead", { eventKind: "order_paid", channel: "email", error: "hỏng" }).chat).toBe("errors");
    expect(telegramMessage("ledger_mismatch", { bankTransactionId: "b1", source: "sepay_webhook", reportedAmountVnd: 1, ledgerAmountVnd: 2 }).chat).toBe("errors");
    const s = telegramMessage("daily_summary", { day: "2026-10-31", paidOrders: 2, revenueVnd: 398000, refunds: 0, queueOpen: 1, outboxDead: 0 });
    expect(s.chat).toBe("business");
    expect(s.text).toContain("398.000");
  });

  it("không đưa nội dung chuyển khoản hay số tài khoản vào tin dù payload có", () => {
    const { text } = telegramMessage("ledger_queued", {
      bankTransactionId: "b1", reason: "wrong_amount", amountVnd: 100000, orderCode: "ME7K3QX9AB",
      content: "CHUYEN TIEN NGUYEN VAN A", accountNo: "0123456789",
    });
    expect(text).not.toContain("NGUYEN VAN A");
    expect(text).not.toContain("0123456789");
  });

  it("loại tin lạ → báo lỗi, không gửi đại", () => {
    expect(() => telegramMessage("la", {})).toThrow();
    expect(() => emailMessage("job_failed", {})).toThrow();
  });
});

describe("telegramSender", () => {
  const cfg = { token: "BIMAT", businessChatId: "-1", errorChatId: "-2" };

  it("thiếu cấu hình → NotConfiguredError, không gọi mạng", async () => {
    const fetchFn = vi.fn();
    await expect(telegramSender({ ...cfg, token: undefined }, fetchFn).send("business", "x")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(telegramSender({ ...cfg, errorChatId: undefined }, fetchFn).send("errors", "x")).rejects.toBeInstanceOf(NotConfiguredError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("gửi đúng nhóm theo loại, văn bản thuần", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
    await telegramSender(cfg, fetchFn).send("errors", "lỗi");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botBIMAT/sendMessage");
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: "-2", text: "lỗi" });
  });

  it("lỗi mạng hoặc HTTP không làm lộ token trong thông báo lỗi", async () => {
    const http = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(telegramSender(cfg, http).send("business", "x")).rejects.toThrow("telegram_http_401");
    const net = vi.fn(async () => { throw new Error("fetch failed https://api.telegram.org/botBIMAT/sendMessage"); });
    const error = await telegramSender(cfg, net).send("business", "x").catch((e: Error) => e);
    expect((error as Error).message).toBe("telegram_network");
  });
});
