import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { googleReady } from "@/modules/auth-oidc/google";
import { emailReady } from "@/modules/mail/email-sender";
import styles from "./admin-login.module.css";
import { AdminLogin } from "./admin-login";

export const metadata: Metadata = { title: "Đăng nhập quản trị", robots: { index: false } };

// Cách đăng nhập nào đang bật được đọc lúc chạy (không đóng băng lúc build).
async function RuntimeAdminLogin({ searchParams }: { searchParams: Promise<{ loi?: string }> }) {
  await connection();
  const { loi } = await searchParams;
  return <AdminLogin googleFailed={loi === "google"} google={googleReady()} email={emailReady()} />;
}

export default function AdminLoginPage({ searchParams }: PageProps<"/admin/dang-nhap">) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2" /><path d="M12 7v14" /><path d="M5 12H3a9 9 0 0 0 18 0h-2" /><path d="M8 10h8" /></svg>
          </span>
          <span className={styles.brandName}>Marine English</span>
          <span className={styles.badge}>Quản trị</span>
        </div>
        <Suspense fallback={<p className={styles.lead}>Đang tải…</p>}>
          <RuntimeAdminLogin searchParams={searchParams as Promise<{ loi?: string }>} />
        </Suspense>
        <Link className={styles.back} href="/">← Về trang chủ</Link>
      </div>
    </main>
  );
}
