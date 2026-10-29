import { Suspense } from "react";
import styles from "../../(site)/dang-nhap/login.module.css";
import { AdminLogin } from "./admin-login";

async function RuntimeAdminLogin({ searchParams }: { searchParams: Promise<{ link?: string; loi?: string }> }) {
  const { link, loi } = await searchParams;
  return <AdminLogin link={link ?? null} googleFailed={loi === "google"} />;
}

export default function AdminLoginPage({ searchParams }: PageProps<"/quan-tri/dang-nhap">) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Quản trị Marine English</h1>
        <p className={styles.lead}>Chỉ dành cho email đã được chủ tài khoản cấp quyền.</p>
        <Suspense>
          <RuntimeAdminLogin searchParams={searchParams as Promise<{ link?: string; loi?: string }>} />
        </Suspense>
      </div>
    </main>
  );
}
