import { describe, expect, it } from "vitest";
import { buildPaymentInfo, sepayEnabled } from "@/modules/orders/payment-info";

const full = {
  CHECKOUT_BANK_NAME: "VCB", SEPAY_ACCOUNT_NO: "0123456789", CHECKOUT_ACCOUNT_NAME: "TEN", CHECKOUT_QR_IMAGE: "/media/qr.png", CHECKOUT_TERMS_VERSION: "v1",
};

describe("buildPaymentInfo", () => {
  it("đủ cấu hình → đủ thông tin", () => {
    expect(buildPaymentInfo(full)).toEqual({ bankName: "VCB", accountNo: "0123456789", accountName: "TEN", qrImageUrl: "/media/qr.png", bankBin: null, termsVersion: "v1" });
  });

  it("có mã BIN ngân hàng thì không cần ảnh QR tĩnh (QR dựng theo từng đơn)", () => {
    expect(buildPaymentInfo({ ...full, CHECKOUT_QR_IMAGE: undefined, CHECKOUT_BANK_BIN: "970422" })).toEqual({
      bankName: "VCB", accountNo: "0123456789", accountName: "TEN", qrImageUrl: null, bankBin: "970422", termsVersion: "v1",
    });
  });

  it("số tài khoản dài quá giới hạn VietQR (19): không dựng QR theo đơn; có ảnh tĩnh thì dùng ảnh, không thì chưa bán", () => {
    const long = "1".repeat(25);
    expect(buildPaymentInfo({ ...full, SEPAY_ACCOUNT_NO: long, CHECKOUT_BANK_BIN: "970422" })).toMatchObject({ bankBin: null, qrImageUrl: "/media/qr.png" });
    expect(buildPaymentInfo({ ...full, SEPAY_ACCOUNT_NO: long, CHECKOUT_BANK_BIN: "970422", CHECKOUT_QR_IMAGE: undefined })).toBeNull();
  });

  it("SePay chỉ coi là bật khi đủ khóa ký, mã ngân hàng và số tài khoản (giống điều kiện của webhook)", () => {
    expect(sepayEnabled({ SEPAY_WEBHOOK_SECRETS: ["s"], SEPAY_BANK_CODE: "MB", SEPAY_ACCOUNT_NO: "0123" })).toBe(true);
    expect(sepayEnabled({ SEPAY_WEBHOOK_SECRETS: ["s"], SEPAY_BANK_CODE: undefined, SEPAY_ACCOUNT_NO: "0123" })).toBe(false);
    expect(sepayEnabled({ SEPAY_WEBHOOK_SECRETS: ["s"], SEPAY_BANK_CODE: "MB", SEPAY_ACCOUNT_NO: undefined })).toBe(false);
    expect(sepayEnabled({ SEPAY_WEBHOOK_SECRETS: [], SEPAY_BANK_CODE: "MB", SEPAY_ACCOUNT_NO: "0123" })).toBe(false);
  });

  it("tài khoản ảo (VA) của SePay: trang thanh toán và QR dùng số VA, webhook vẫn đối chiếu theo tài khoản chính", () => {
    // BIDV qua SePay chỉ báo tiền vào VA (chủ 12/11/2026: VA 962473XSFY, tài khoản chính 2201189792).
    expect(buildPaymentInfo({ ...full, SEPAY_ACCOUNT_NO: "2201189792", CHECKOUT_ACCOUNT_NO: "962473XSFY", CHECKOUT_QR_IMAGE: undefined, CHECKOUT_BANK_BIN: "970418" }))
      .toMatchObject({ accountNo: "962473XSFY", bankBin: "970418", qrImageUrl: null });
  });

  it("không có cả mã BIN lẫn ảnh QR → không bán", () => {
    expect(buildPaymentInfo({ ...full, CHECKOUT_QR_IMAGE: undefined, CHECKOUT_BANK_BIN: undefined })).toBeNull();
  });

  it.each(Object.keys(full).filter((k) => k !== "CHECKOUT_QR_IMAGE"))("thiếu hoặc rỗng %s → không bán", (name) => {
    expect(buildPaymentInfo({ ...full, [name]: undefined })).toBeNull();
    expect(buildPaymentInfo({ ...full, [name]: "" })).toBeNull();
  });
});
