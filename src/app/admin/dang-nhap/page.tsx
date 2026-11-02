import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { googleReady } from "@/modules/auth-oidc/google";
import { emailReady } from "@/modules/mail/email-sender";
import styles from "../../(site)/dang-nhap/login.module.css";
import { SiteFooter } from "../../(site)/site-footer";
import { SiteHeader } from "../../(site)/site-header";
import { AdminLogin } from "./admin-login";

export const metadata: Metadata = { title: "Đăng nhập quản trị", robots: { index: false } };

// Cách đăng nhập nào đang bật được đọc lúc chạy (không đóng băng lúc build).
async function RuntimeAdminLogin({ searchParams }: { searchParams: Promise<{ loi?: string }> }) {
  await connection();
  const { loi } = await searchParams;
  return <AdminLogin googleFailed={loi === "google"} google={googleReady()} email={emailReady()} />;
}

/** Cùng khung với màn đăng nhập học viên (thanh menu, chân trang của site); D3: email + mật khẩu, không tạo tài khoản. */
export default function AdminLoginPage({ searchParams }: PageProps<"/admin/dang-nhap">) {
  return (
    <>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.card}>
          <Suspense fallback={<p className={styles.note}>Đang tải…</p>}>
            <RuntimeAdminLogin searchParams={searchParams as Promise<{ loi?: string }>} />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
