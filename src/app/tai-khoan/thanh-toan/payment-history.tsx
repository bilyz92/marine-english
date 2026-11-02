"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatVnd } from "@/lib/format";
import styles from "../../hoc/learn.module.css";

// Lịch sử thanh toán (menu điện thoại): mọi đơn của học viên, mới nhất trước. Đơn còn chờ và chưa hết hạn có nút xem cách chuyển khoản.

type Payment = { code: string; course: string; slug: string; amountVnd: number; status: string; createdAt: string; paidAt: string | null; payableForSeconds: number };

const STATUS: Record<string, string> = { pending: "Chờ thanh toán", paid: "Đã thanh toán", expired: "Hết hạn", refunded: "Đã hoàn tiền" };
const vnTime = (iso: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

export function PaymentHistory() {
  const [state, setState] = useState<{ payments: Payment[] } | "login" | "error" | null>(null);
  // Đơn đã hết hạn chuyển khoản trong lúc đang xem (đếm theo số giây máy chủ báo, không dùng giờ của điện thoại).
  const [lapsed, setLapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetch("/api/me/payments", { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 401) return setState("login");
        if (!res.ok) return setState("error");
        setState((await res.json()) as { payments: Payment[] });
      })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, []);

  // Hẹn giờ theo số giây còn lại của từng đơn: hết hạn thì nút "Xem cách chuyển khoản" biến mất.
  useEffect(() => {
    if (typeof state !== "object" || !state) return;
    const timers = state.payments
      .filter((p) => p.payableForSeconds > 0)
      .map((p) => setTimeout(() => setLapsed((prev) => new Set(prev).add(p.code)), p.payableForSeconds * 1000));
    return () => timers.forEach(clearTimeout);
  }, [state]);

  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.card}>
          <h1 className={styles.h1}>Lịch sử thanh toán</h1>
          {state === null && <p className={styles.muted}>Đang tải…</p>}
          {state === "login" && <p className={styles.muted}>Đăng nhập để xem đơn của bạn. <a className={styles.barLink} href="/dang-nhap">Đăng nhập</a></p>}
          {state === "error" && <p className={styles.muted}>Chưa tải được. Kiểm tra mạng rồi mở lại trang.</p>}
          {typeof state === "object" && state?.payments.length === 0 && <p className={styles.muted}>Chưa có đơn nào. <Link className={styles.barLink} href="/khoa-hoc">Xem các khóa học</Link></p>}
        </div>
        {typeof state === "object" && state?.payments.map((p) => {
          const open = p.payableForSeconds > 0 && !lapsed.has(p.code);
          // Đơn chờ đã quá hạn (máy chủ chưa kịp đổi trạng thái) hiện là hết hạn.
          const status = p.status === "pending" && !open ? "expired" : p.status;
          return (
            <div key={p.code} className={styles.card}>
              <p className={styles.en}>{p.course}</p>
              <p className={styles.vi}>{p.code} · {formatVnd(p.amountVnd)}</p>
              <p className={styles.muted}>
                {STATUS[status] ?? status} · {p.paidAt ? `thanh toán lúc ${vnTime(p.paidAt)}` : `tạo lúc ${vnTime(p.createdAt)}`}
              </p>
              {open && <p><a className={styles.barLink} href={`/thanh-toan/${p.code}`}>Xem cách chuyển khoản</a></p>}
            </div>
          );
        })}
      </div>
    </main>
  );
}
