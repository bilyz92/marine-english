import { env, type Env } from "@/lib/env";
import { VIETQR_ACCOUNT } from "./vietqr";

/** qrImageUrl: ảnh QR tĩnh (không có số tiền). bankBin: có thì dựng QR theo từng đơn, đã điền số tiền và mã đơn. */
export type PaymentInfo = { bankName: string; accountNo: string; accountName: string; qrImageUrl: string | null; bankBin: string | null; termsVersion: string };

type CheckoutEnv = Pick<Env, "CHECKOUT_BANK_NAME" | "SEPAY_ACCOUNT_NO" | "CHECKOUT_ACCOUNT_NAME" | "CHECKOUT_QR_IMAGE" | "CHECKOUT_TERMS_VERSION"> & { CHECKOUT_BANK_BIN?: string };

/**
 * Thông tin nhận tiền và phiên bản điều khoản đã duyệt. Thiếu mục nào (hoặc không có cả mã BIN lẫn ảnh QR) thì trả null
 * và không được bán: người mua không bao giờ thấy thông tin chuyển khoản thiếu hay sai.
 */
export function buildPaymentInfo(e: CheckoutEnv): PaymentInfo | null {
  const { CHECKOUT_BANK_NAME: bankName, SEPAY_ACCOUNT_NO: accountNo, CHECKOUT_ACCOUNT_NAME: accountName, CHECKOUT_QR_IMAGE: qr, CHECKOUT_BANK_BIN: bin, CHECKOUT_TERMS_VERSION: termsVersion } = e;
  // VietQR nhận số tài khoản tối đa 19 ký tự: dài hơn thì không dựng QR theo đơn (dùng ảnh tĩnh nếu có).
  const usableBin = bin && accountNo && VIETQR_ACCOUNT.test(accountNo) ? bin : null;
  if (!bankName || !accountNo || !accountName || !termsVersion || (!qr && !usableBin)) return null;
  return { bankName, accountNo, accountName, qrImageUrl: qr || null, bankBin: usableBin, termsVersion };
}

/** Webhook SePay xử lý được (cùng điều kiện với route webhook): tiền về là tự mở khóa. */
export function sepayEnabled(e: Pick<Env, "SEPAY_WEBHOOK_SECRETS" | "SEPAY_BANK_CODE" | "SEPAY_ACCOUNT_NO">): boolean {
  return e.SEPAY_WEBHOOK_SECRETS.length > 0 && !!e.SEPAY_BANK_CODE && !!e.SEPAY_ACCOUNT_NO;
}

export const paymentInfo = () => buildPaymentInfo(env());
