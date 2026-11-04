import type { Metadata } from "next";
import { Account } from "./account";

export const metadata: Metadata = { title: "Tài khoản của tôi", robots: { index: false } };

export default function AccountPage() {
  return <Account />;
}
