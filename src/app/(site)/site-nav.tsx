"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { InstallApp } from "@/components/install-app";
import { useSignedIn } from "@/components/learner-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { AccountMenu, type Account } from "./account-menu";
import styles from "./site.module.css";

// Menu đầu trang. Máy tính: một hàng. Điện thoại: một hàng logo + nút Menu, bấm mới mở danh sách.
// Đã đăng nhập: thay các mục giới thiệu bằng các mục của học viên, bỏ nút mời học thử.

const GUEST = [["/khoa-hoc", "Khóa học"], ["/#cach-hoc", "Cách học"], ["/#hoi-dap", "Hỏi đáp"], ["/gioi-thieu", "Về tôi"]];
const LEARNER = [["/khoa-hoc", "Khóa học"], ["/hoc", "Khóa của tôi"], ["/tai-khoan/thanh-toan", "Thanh toán"], ["/gioi-thieu", "Về tôi"]];

export function SiteNav() {
  const pathname = usePathname(); // Dựng lại khi chuyển trang: vừa đăng nhập xong là menu đổi ngay.
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  // Đã đăng nhập: nút tài khoản hiện tên và email (hoặc số điện thoại) của học viên; chưa đọc xong thì ghi "Tài khoản".
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let stale = false;
    void fetch("/api/me/session", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ displayName?: string; accountLabel?: string }>) : null))
      .then((body) => { if (!stale && body?.accountLabel) setAccount({ name: body.displayName ?? "", label: body.accountLabel }); })
      .catch(() => {});
    return () => { stale = true; };
  }, [signedIn]);
  const close = () => setOpen(false);
  return (
    <>
      {!signedIn && <Link href="/dang-nhap" className={styles.phoneLogin}>Đăng nhập</Link>}
      <button type="button" className={styles.menuButton} aria-label="Menu" aria-expanded={open} aria-controls="menu-chinh" onClick={() => setOpen(!open)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={open ? "M6 6l12 12M18 6 6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
      </button>
      <nav id="menu-chinh" aria-label="Menu chính" className={open ? styles.navOpen : styles.nav}>
        {(signedIn ? LEARNER : GUEST).map(([href, label]) => (
          <Link key={href} href={href!} className={styles.navLink} onClick={close} aria-current={!href!.includes("#") && pathname.startsWith(href!) ? "page" : undefined}>{label}</Link>
        ))}
        <InstallApp className={styles.navInstall} label="Tải app" />
        <ThemeToggle className={styles.navTheme} />
        {signedIn ? <AccountMenu account={account} onNavigate={close} /> : (
          <Link href="/dang-nhap" className={styles.navLink} onClick={close} aria-current={pathname.startsWith("/dang-nhap") ? "page" : undefined}>Đăng nhập</Link>
        )}
        {!signedIn && <Link href="/khoa-hoc" className={styles.navCta} onClick={close}>Học thử miễn phí</Link>}
      </nav>
    </>
  );
}
