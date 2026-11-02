import type { Metadata } from "next";
import { PaymentHistory } from "./payment-history";

export const metadata: Metadata = { title: "Lịch sử thanh toán", robots: { index: false } };

export default function PaymentHistoryPage() {
  return <PaymentHistory />;
}
