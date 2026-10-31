"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AdminContext, adminApi, type AdminMe } from "./admin-lib";
import styles from "./admin.module.css";

const NAV: { href: string; label: string; permission: string }[] = [
  { href: "/quan-tri", label: "Tổng quan", permission: "orders.view" },
  { href: "/quan-tri/so-giao-dich", label: "Sổ giao dịch", permission: "orders.view" },
  { href: "/quan-tri/hoan-tien", label: "Hoàn tiền", permission: "orders.view" },
  { href: "/quan-tri/don-hang", label: "Đơn hàng", permission: "orders.view" },
  { href: "/quan-tri/hoc-vien", label: "Học viên", permission: "orders.view" },
  { href: "/quan-tri/khoa-hoc", label: "Khóa học", permission: "orders.view" },
  { href: "/quan-tri/cap-khoa", label: "Cấp không thu tiền", permission: "grants.create" },
  { href: "/quan-tri/gop-tai-khoan", label: "Gộp tài khoản", permission: "accounts.merge" },
  { href: "/quan-tri/quan-tri-vien", label: "Quản trị viên", permission: "admins.manage" },
  { href: "/quan-tri/jobs", label: "Job", permission: "jobs.run" },
];
const BOTTOM = 4;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [showMore, setShowMore] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    void adminApi<AdminMe>("/api/quan-tri/me").then((r) => { if (r.ok) setMe(r.data); });
  }, []);

  async function logout() {
    await adminApi("/api/auth/admin/logout", { method: "POST", body: {} });
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- đăng xuất: tải lại toàn trang để bỏ trạng thái cũ.
    window.location.assign("/quan-tri/dang-nhap");
  }

  // Ẩn mục chỉ để gọn; quyền thật do từng API kiểm. Chưa biết vai trò thì chỉ hiện mục chung.
  const items = NAV.filter((n) => me?.permissions.includes(n.permission));
  const isActive = (href: string) => (href === "/quan-tri" ? pathname === href : pathname.startsWith(href));

  return (
    <AdminContext.Provider value={me}>
      <div className={styles.shell}>
        <nav aria-label="Menu quản trị" className={styles.side}>
          <span className={styles.brand}>Marine English</span>
          {items.map((n) => <Link key={n.href} href={n.href} className={isActive(n.href) ? styles.navActive : styles.navLink} aria-current={isActive(n.href) ? "page" : undefined}>{n.label}</Link>)}
          <div className={styles.who}>
            {me && <span>{me.email} · {me.role === "owner" ? "Chủ" : "Hỗ trợ"}</span>}
            <button className={styles.btn} onClick={() => void logout()}>Đăng xuất</button>
          </div>
        </nav>
        <main className={styles.main}>{children}</main>
        {showMore && (
          <nav aria-label="Mục khác" className={styles.more}>
            {items.slice(BOTTOM).map((n) => <Link key={n.href} href={n.href} className={styles.navLink} onClick={() => setShowMore(false)}>{n.label}</Link>)}
            <button className={styles.btn} onClick={() => void logout()}>Đăng xuất</button>
          </nav>
        )}
        <nav aria-label="Menu chính" className={styles.bottom}>
          {items.slice(0, BOTTOM).map((n) => <Link key={n.href} href={n.href} className={isActive(n.href) ? styles.bottomActive : styles.bottomLink} aria-current={isActive(n.href) ? "page" : undefined}>{n.label}</Link>)}
          <button className={styles.bottomLink} aria-expanded={showMore} onClick={() => setShowMore(!showMore)}>Thêm</button>
        </nav>
      </div>
    </AdminContext.Provider>
  );
}
