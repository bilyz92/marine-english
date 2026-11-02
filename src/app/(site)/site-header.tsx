import Link from "next/link";
import { InstallApp } from "@/components/install-app";
import { AccountLink } from "@/components/learner-nav";
import ui from "@/components/ui.module.css";
import styles from "./site.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={`${ui.wrap} ${styles.headerRow}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.logo}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="2" /><path d="M12 7v14" /><path d="M5 12H3a9 9 0 0 0 18 0h-2" /><path d="M8 10h8" /></svg>
          </span>
          Marine English
        </Link>
        <nav aria-label="Menu chính" className={styles.nav}>
          <Link href="/khoa-hoc" className={styles.navLink}>Khóa học</Link>
          <Link href="/#cach-hoc" className={styles.navLink}>Cách học</Link>
          <Link href="/#hoi-dap" className={styles.navLink}>Hỏi đáp</Link>
          <Link href="/gioi-thieu" className={styles.navLink}>Về tôi</Link>
          <InstallApp className={styles.navInstall} label="Tải app" />
          <AccountLink className={styles.navLink} />
          <Link href="/khoa-hoc" className={styles.navCta}>Học thử miễn phí</Link>
        </nav>
      </div>
    </header>
  );
}
