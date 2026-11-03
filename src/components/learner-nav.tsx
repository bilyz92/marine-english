"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import styles from "./learner-nav.module.css";

// Menu điện thoại cho học viên đã đăng nhập: Trang chủ, Khóa học, Khóa của tôi, Thanh toán, Tìm kiếm.
// Nhận biết đã đăng nhập qua cookie CSRF học viên (đọc được ở trình duyệt); quyền thật luôn do máy chủ kiểm.

const CSRF_COOKIE = "__Host-me_csrf_learner=";
const signedIn = () => document.cookie.split("; ").some((c) => c.startsWith(CSRF_COOKIE));
const noSubscription = () => () => {};

const Icon = ({ d }: { d: string }) => (
  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const ITEMS = [
  { href: "/", label: "Trang chủ", d: "M3 11 12 4l9 7M5 10v10h5v-6h4v6h5V10", active: (p: string) => p === "/" },
  { href: "/khoa-hoc", label: "Khóa học", d: "M4 5h7v14H4zM13 5h7v14h-7z", active: (p: string) => p.startsWith("/khoa-hoc") || p.startsWith("/mua") },
  { href: "/hoc", label: "Khóa của tôi", d: "M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2zM8 7h6", active: (p: string) => p.startsWith("/hoc") },
  { href: "/tai-khoan/thanh-toan", label: "Thanh toán", d: "M3 6h18v12H3zM3 10h18M7 15h3", active: (p: string) => p.startsWith("/tai-khoan/thanh-toan") || p.startsWith("/thanh-toan") },
  { href: "/khoa-hoc?tim=1", label: "Tìm kiếm", d: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4", active: () => false },
];

/** Đã đăng nhập chưa (theo cookie, chỉ để chọn menu; quyền thật do máy chủ kiểm). */
export const useSignedIn = () => useSyncExternalStore(noSubscription, signedIn, () => false);

/** Đang ở trang Khóa học: đưa con trỏ vào ô tìm luôn (điều hướng tới cùng trang không dựng lại ô tìm). */
function focusSearch(event: React.MouseEvent, pathname: string) {
  const box = pathname === "/khoa-hoc" ? document.getElementById("tim-khoa-hoc") : null;
  if (!box) return;
  event.preventDefault();
  box.scrollIntoView({ block: "center" });
  box.focus();
}

export function LearnerNav() {
  const pathname = usePathname();
  const show = useSignedIn();
  if (!show || pathname.startsWith("/admin")) return null;
  return (
    <>
      <div className={styles.spacer} aria-hidden="true" />
      <nav aria-label="Menu học viên" className={styles.nav}>
        {ITEMS.map((i) => {
          const on = i.active(pathname);
          return (
            <Link key={i.label} href={i.href} className={on ? styles.active : styles.item} aria-current={on ? "page" : undefined}
              onClick={i.label === "Tìm kiếm" ? (e) => focusSearch(e, pathname) : undefined}>
              <Icon d={i.d} />
              <span>{i.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
