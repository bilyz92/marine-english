import { describe, expect, it } from "vitest";
import { buyFlowCopy } from "@/app/(site)/home-copy";

// Trang chủ: các bước mua và câu hỏi "bao lâu thì học được" phải khớp cách mua đang chạy (chủ 17/11/2026).

describe("buyFlowCopy", () => {
  it("SePay bật, khách mua không cần tài khoản: điền email, tiền về là tự mở, thông tin đăng nhập qua email", () => {
    const c = buyFlowCopy({ autoConfirm: true, guestOpen: true });
    expect(c.steps).toHaveLength(3);
    expect(c.steps[0]!.text).toContain("email");
    expect(c.steps[2]!.title).toBe("Tiền về, khóa học tự mở");
    expect(c.steps[2]!.text).toContain("gửi thông tin đăng nhập vào email");
    expect(c.paidAnswer).toContain("tự nhận tiền");
    expect(JSON.stringify(c)).not.toContain("Tôi đã chuyển khoản");
  });

  it("SePay bật nhưng chưa gửi được email: phải đăng nhập hoặc tạo tài khoản trước", () => {
    const c = buyFlowCopy({ autoConfirm: true, guestOpen: false });
    expect(c.steps[0]!.text).toContain("tạo tài khoản");
    expect(c.steps[2]!.text).not.toContain("email");
    expect(JSON.stringify(c)).not.toContain("Tôi đã chuyển khoản");
  });

  it("SePay tắt, khách mua không cần tài khoản: không hứa nút khách không có; chủ xác nhận rồi gửi email", () => {
    const c = buyFlowCopy({ autoConfirm: false, guestOpen: true });
    expect(c.steps[2]!.title).not.toContain("Tôi đã chuyển khoản");
    expect(c.steps[2]!.text).toContain("chủ khóa học xác nhận");
    expect(c.steps[2]!.text).toContain("email");
    expect(c.paidAnswer).toContain("Mua khi chưa có tài khoản");
  });

  it("SePay tắt: còn nút “Tôi đã chuyển khoản”", () => {
    const c = buyFlowCopy({ autoConfirm: false, guestOpen: false });
    expect(c.steps[2]!.title).toContain("Tôi đã chuyển khoản");
    expect(c.paidAnswer).toContain("Tôi đã chuyển khoản");
  });
});
