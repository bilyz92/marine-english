import { Suspense } from "react";
import { connection } from "next/server";
import styles from "./login.module.css";
import { LoginForm } from "./login-form";

// Cờ Zalo đọc lúc chạy (không đóng băng lúc build).
async function RuntimeLoginForm({ searchParams }: { searchParams: Promise<{ loi?: string; next?: string }> }) {
  await connection();
  const { loi, next } = await searchParams;
  // Chỉ nhận đường dẫn trong site, không cho chuyển hướng ra ngoài.
  const target = next && /^\/(?![/\\])/.test(next) ? next : "/hoc";
  return <LoginForm zaloEnabled={process.env.ZALO_LOGIN_ENABLED === "true"} googleFailed={loi === "google"} next={target} />;
}

export default function LoginPage({ searchParams }: PageProps<"/dang-nhap">) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Đăng ký và đăng nhập</h1>
        <p className={styles.lead}>Chỉ cần tên, một cách liên hệ và chức danh. Hồ sơ đầy đủ có thể bổ sung sau, lúc nào tiện.</p>
        <Suspense>
          <RuntimeLoginForm searchParams={searchParams as Promise<{ loi?: string; next?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
