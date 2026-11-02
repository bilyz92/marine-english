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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={36} height={36} />
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
