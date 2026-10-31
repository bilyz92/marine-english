import { env, type Env } from "@/lib/env";

export type PaymentInfo = { bankName: string; accountNo: string; accountName: string; qrImageUrl: string; termsVersion: string };

type CheckoutEnv = Pick<Env, "CHECKOUT_BANK_NAME" | "SEPAY_ACCOUNT_NO" | "CHECKOUT_ACCOUNT_NAME" | "CHECKOUT_QR_IMAGE" | "CHECKOUT_TERMS_VERSION">;

/**
 * Thông tin nhận tiền và phiên bản điều khoản đã duyệt. Thiếu bất kỳ mục nào thì trả null và không được bán:
 * người mua không bao giờ thấy thông tin chuyển khoản thiếu hay sai.
 */
export function buildPaymentInfo(e: CheckoutEnv): PaymentInfo | null {
  const { CHECKOUT_BANK_NAME: bankName, SEPAY_ACCOUNT_NO: accountNo, CHECKOUT_ACCOUNT_NAME: accountName, CHECKOUT_QR_IMAGE: qrImageUrl, CHECKOUT_TERMS_VERSION: termsVersion } = e;
  if (!bankName || !accountNo || !accountName || !qrImageUrl || !termsVersion) return null;
  return { bankName, accountNo, accountName, qrImageUrl, termsVersion };
}

export const paymentInfo = () => buildPaymentInfo(env());
