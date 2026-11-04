import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { googleReady } from "@/modules/auth-oidc/google";
import { emailReady } from "@/modules/mail/email-sender";
import { safeNext } from "@/lib/client/safe-next";
import styles from "./login.module.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng ký và đăng nhập", robots: { index: false } };

// Cờ Zalo đọc lúc chạy (không đóng băng lúc build).
async function RuntimeLoginForm({ searchParams }: { searchParams: Promise<{ loi?: string; next?: string }> }) {
  await connection();
  const { loi, next } = await searchParams;
  const target = safeNext(next, env().APP_ORIGIN);
  return <LoginForm zaloEnabled={process.env.ZALO_LOGIN_ENABLED === "true"} googleFailed={loi === "google"} next={target} google={googleReady()} email={emailReady()} />;
}

export default function LoginPage({ searchParams }: PageProps<"/dang-nhap">) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Đăng ký và đăng nhập</h1>
        <p className={styles.lead}>Tạo tài khoản hoặc đăng nhập để mua và học khóa. Hồ sơ đầy đủ có thể bổ sung sau, lúc nào tiện.</p>
        <Suspense fallback={<p className={styles.note}>Đang tải…</p>}>
          <RuntimeLoginForm searchParams={searchParams as Promise<{ loi?: string; next?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
