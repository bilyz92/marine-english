import { describe, expect, it } from "vitest";
import { buildPaymentInfo } from "@/modules/orders/payment-info";

const full = {
  CHECKOUT_BANK_NAME: "VCB", SEPAY_ACCOUNT_NO: "0123456789", CHECKOUT_ACCOUNT_NAME: "TEN", CHECKOUT_QR_IMAGE: "/media/qr.png", CHECKOUT_TERMS_VERSION: "v1",
};

describe("buildPaymentInfo", () => {
  it("đủ cấu hình → đủ thông tin", () => {
    expect(buildPaymentInfo(full)).toEqual({ bankName: "VCB", accountNo: "0123456789", accountName: "TEN", qrImageUrl: "/media/qr.png", termsVersion: "v1" });
  });

  it.each(Object.keys(full))("thiếu hoặc rỗng %s → không bán", (name) => {
    expect(buildPaymentInfo({ ...full, [name]: undefined })).toBeNull();
    expect(buildPaymentInfo({ ...full, [name]: "" })).toBeNull();
  });
});
