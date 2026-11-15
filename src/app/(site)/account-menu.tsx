"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadIdentity, signOut } from "@/lib/offline/engine";
import styles from "./site.module.css";

// Nút tài khoản của học viên đã đăng nhập (chủ 16/11/2026, theo mẫu Cole): vòng chữ cái đầu tên, tên và email (hoặc số điện thoại);
// bấm mở menu Tài khoản của tôi, Đăng xuất (Khóa của tôi, Thanh toán đã có ở menu chính). Trên điện thoại nằm cuối menu chính.

export type Account = { name: string; label: string };

/** Chữ cái đầu của hai từ cuối tên ("Nguyễn Việt Hưng" → "VH"); tên rỗng → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(-2).map((w) => w[0]!.toLocaleUpperCase("vi")).join("") || "?";
}

export function AccountMenu({ account, onNavigate }: { account: Account | null; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const done = () => { setOpen(false); onNavigate(); };

  // Như nút Đăng xuất ở trang Tài khoản: chỉ khi có mạng (gửi nốt tiến độ trước khi xóa bài đã tải trên máy này), rồi tải lại trang đăng nhập.
  async function logout() {
    setBusy(true);
    setError(null);
    try {
      const { identity, online } = await loadIdentity();
      if (!online) return setError("Đang mất mạng: đăng xuất lúc này sẽ mất tiến độ chưa gửi. Thử lại khi có mạng.");
      if (identity) await signOut(identity);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dang-nhap");
    } catch {
      setError("Chưa đăng xuất được. Thử lại khi có mạng.");
    } finally {
      setBusy(false);
    }
  }

  const name = account?.name || "Tài khoản";
  const label = account && account.label !== account.name ? account.label : null;
  return (
    <div ref={box} className={styles.account}>
      <button type="button" className={styles.accountButton} aria-expanded={open} aria-controls="menu-tai-khoan"
        title={account ? `${account.name} · ${account.label}` : undefined} onClick={() => setOpen(!open)}>
        <span className={styles.avatar} aria-hidden="true">{initials(account?.name ?? "")}</span>
        <span className={styles.accountText}>
          <span className={styles.accountName}>{name}</span>
          {label && <span className={styles.accountLabel}>{label}</span>}
        </span>
        <svg aria-hidden="true" className={styles.caret} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div id="menu-tai-khoan" className={open ? styles.accountMenuOpen : styles.accountMenu}>
        <Link href="/tai-khoan" className={styles.accountItem} onClick={done}>Tài khoản của tôi</Link>
        <button type="button" className={styles.accountLogout} disabled={busy} onClick={() => void logout()}>
          {busy ? "Đang đăng xuất…" : "Đăng xuất"}
          <span className={styles.accountHint}>Xóa bài đã tải trên máy này</span>
        </button>
        {error && <p className={styles.accountError} role="alert">{error}</p>}
      </div>
    </div>
  );
}
