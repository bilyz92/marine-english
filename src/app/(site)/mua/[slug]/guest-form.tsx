"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "../../dang-nhap/api";
import styles from "./buy.module.css";
import ui from "@/components/ui.module.css";

// Khách chưa có tài khoản đặt mua (chủ 16/11/2026, docs/superpowers/plans/2026-11-16-guest-orders.md): chỉ tạo đơn. Thanh toán xong
// hệ thống mới tạo tài khoản theo thông tin này và gửi thông tin đăng nhập vào email (không hiện trên trang). Số/email đã có tài khoản
// thì báo trùng, mời đăng nhập.

const ERRORS: Record<string, string> = {
  invalid_phone: "Số điện thoại chưa đúng. Nhập số di động Việt Nam, ví dụ 0912 345 678.",
  invalid_email: "Email chưa đúng dạng.",
  email_mismatch: "Hai lần nhập email chưa giống nhau.",
  pending_order: "Số điện thoại hoặc email này đang có đơn chờ thanh toán. Mở lại trang đơn trên máy đã đặt, hoặc đợi hết 15 phút rồi đặt lại.",
  throttled: "Bạn đặt quá nhiều đơn trong một giờ. Thử lại sau.",
  not_for_sale: "Khóa học này hiện không bán.",
  payment_unavailable: "Chưa mở thanh toán. Vui lòng quay lại sau.",
  email_unavailable: "Chưa mở mua cho khách chưa có tài khoản. Tạo tài khoản hoặc đăng nhập để mua.",
};

export function GuestForm({ slug, terms, termsAccepted, onBlocked }: {
  slug: string; terms: React.ReactNode; termsAccepted: boolean; onBlocked: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState<"phone" | "email" | null>(null);
  const [busy, setBusy] = useState(false);
  const loginHref = `/dang-nhap?next=${encodeURIComponent(`/mua/${slug}`)}`;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setTaken(null);
    if (!name.trim()) return setError("Nhập họ và tên.");
    if (!phone.trim()) return setError("Nhập số điện thoại.");
    if (!email.trim()) return setError("Nhập email để nhận thông tin đăng nhập.");
    if (email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) return setError(ERRORS.email_mismatch!);
    if (!termsAccepted) return onBlocked();
    setBusy(true);
    try {
      const r = await postJson<{ code?: string; error?: string }>("/api/public/orders", {
        courseSlug: slug, displayName: name.trim(), phone, email: email.trim(), emailConfirm: emailConfirm.trim(), acceptTerms: true,
      });
      if (r.status === 0) return setError("Không kết nối được. Kiểm tra mạng rồi thử lại.");
      if (r.data.code) return router.push(`/don-hang/${r.data.code}`);
      if (r.data.error === "phone_taken") return setTaken("phone");
      if (r.data.error === "email_taken") return setTaken("email");
      setError(ERRORS[r.data.error ?? ""] ?? "Chưa đặt được đơn, thử lại sau.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.guest} onSubmit={(e) => void submit(e)}>
      <label className={styles.field}>
        <span>Họ và tên *</span>
        <input className={styles.input} autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Số điện thoại *</span>
        <input className={styles.input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <small className={ui.muted}>Dùng số này để đăng nhập sau khi thanh toán.</small>
      </label>
      <label className={styles.field}>
        <span>Email *</span>
        <input className={styles.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <small className={ui.muted}>Thanh toán xong, hệ thống tạo tài khoản và gửi thông tin đăng nhập vào email này.</small>
      </label>
      <label className={styles.field}>
        <span>Nhập lại email *</span>
        <input className={styles.input} type="email" autoComplete="off" value={emailConfirm} onChange={(e) => setEmailConfirm(e.target.value)} />
      </label>
      {terms}
      {taken && (
        <div className={ui.notice} role="alert">
          <p>{taken === "phone" ? "Số điện thoại này đã có tài khoản." : "Email này đã có tài khoản."}</p>
          <p><Link href={loginHref}>Đăng nhập để mua</Link> · Quên mật khẩu? <Link href="/lien-he">Liên hệ hỗ trợ</Link></p>
        </div>
      )}
      {error && <p className={ui.error} role="alert">{error}</p>}
      <button className={ui.action} disabled={busy}>{busy ? "Đang đặt đơn…" : "Đặt hàng và thanh toán"}</button>
      <p className={ui.muted}>Đã có tài khoản? <Link href={loginHref}>Đăng nhập</Link></p>
    </form>
  );
}
