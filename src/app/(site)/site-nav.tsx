"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { InstallApp } from "@/components/install-app";
import { useSignedIn } from "@/components/learner-nav";
import styles from "./site.module.css";

// Menu đầu trang. Máy tính: một hàng. Điện thoại: một hàng logo + nút Menu, bấm mới mở danh sách.
// Đã đăng nhập: thay các mục giới thiệu bằng các mục của học viên, bỏ nút mời học thử.

const GUEST = [["/khoa-hoc", "Khóa học"], ["/#cach-hoc", "Cách học"], ["/#hoi-dap", "Hỏi đáp"], ["/gioi-thieu", "Về tôi"]];
const LEARNER = [["/khoa-hoc", "Khóa học"], ["/hoc", "Khóa của tôi"], ["/tai-khoan/thanh-toan", "Thanh toán"], ["/gioi-thieu", "Về tôi"]];

export function SiteNav() {
  const pathname = usePathname(); // Dựng lại khi chuyển trang: vừa đăng nhập xong là menu đổi ngay.
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
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
        <Link href={signedIn ? "/tai-khoan" : "/dang-nhap"} className={styles.navLink} onClick={close}
          aria-current={(signedIn ? pathname === "/tai-khoan" : pathname.startsWith("/dang-nhap")) ? "page" : undefined}>{signedIn ? "Tài khoản" : "Đăng nhập"}</Link>
        {!signedIn && <Link href="/khoa-hoc" className={styles.navCta} onClick={close}>Học thử miễn phí</Link>}
      </nav>
    </>
  );
}
