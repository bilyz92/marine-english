import { Suspense } from "react";
import { connection } from "next/server";
import styles from "./login.module.css";
import { LoginForm } from "./login-form";

// Cờ Zalo đọc lúc chạy (không đóng băng lúc build).
async function RuntimeLoginForm() {
  await connection();
  return <LoginForm zaloEnabled={process.env.ZALO_LOGIN_ENABLED === "true"} />;
}

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Đăng ký và đăng nhập</h1>
        <p className={styles.lead}>Chỉ cần tên, một cách liên hệ và chức danh. Hồ sơ đầy đủ có thể bổ sung sau, lúc nào tiện.</p>
        <Suspense>
          <RuntimeLoginForm />
        </Suspense>
      </div>
    </main>
  );
}
