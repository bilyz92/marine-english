"use client";

import { useEffect, useState } from "react";
import { learnerCsrfHeader } from "@/lib/client/api";
import styles from "../hoc/learn.module.css";

type Login = { phone: string; verified: boolean; released: boolean } | null;

const MESSAGE: Record<string, string> = {
  invalid_current: "Mật khẩu hiện tại không đúng.",
  locked: "Sai quá nhiều lần. Đợi 15 phút rồi thử lại.",
  reauth_required: "Vì an toàn, cần đăng nhập lại (trong 10 phút gần đây) mới thêm được số điện thoại.",
  phone_required: "Nhập số điện thoại.",
  invalid_phone: "Số điện thoại không đúng. Nhập số di động Việt Nam, ví dụ 0912 345 678.",
  phone_taken: "Số này đã thuộc tài khoản khác.",
  inactive: "Tài khoản không còn hoạt động.",
};
const WEAK: Record<string, string> = {
  too_short: "Mật khẩu cần ít nhất 8 ký tự.",
  too_long: "Mật khẩu dài quá 128 ký tự.",
  common: "Mật khẩu này quá dễ đoán, chọn mật khẩu khác.",
  phone: "Không dùng chính số điện thoại làm mật khẩu.",
};

/** D2: đổi mật khẩu, hoặc thêm số + mật khẩu cho tài khoản email/Google. */
export function PasswordSection() {
  const [login, setLogin] = useState<Login | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Tăng `version` để tải lại sau khi đổi.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    void fetch("/api/me/password", { cache: "no-store" })
      .then(async (res) => { if (res.ok) setLogin(((await res.json()) as { passwordLogin: Login }).passwordLogin); });
  }, [version]);

  const hasLive = Boolean(login && !login.released);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "content-type": "application/json", ...learnerCsrfHeader() },
        body: JSON.stringify(hasLive ? { currentPassword: current, newPassword: next } : { phone, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; problem?: string };
      if (data.ok) {
        setCurrent("");
        setNext("");
        setMessage({ ok: true, text: hasLive ? "Đã đổi mật khẩu. Các máy khác đã bị đăng xuất." : "Đã thêm đăng nhập bằng số điện thoại." });
        return setVersion(version + 1);
      }
      setMessage({ ok: false, text: data.error === "weak_password" ? WEAK[data.problem ?? ""] ?? "Mật khẩu chưa hợp lệ." : MESSAGE[data.error ?? ""] ?? "Không thực hiện được, thử lại sau." });
    } catch {
      // Mất mạng (trên tàu hay gặp): báo và cho bấm lại.
      setMessage({ ok: false, text: "Không kết nối được. Kiểm tra mạng rồi bấm lại." });
    } finally {
      setBusy(false);
    }
  }

  if (login === undefined) return null;
  return (
    <form className={styles.card} onSubmit={submit}>
      <h2 className={styles.h2}>Số điện thoại và mật khẩu</h2>
      {hasLive && <p className={styles.vi}>Đăng nhập bằng {login!.phone}{login!.verified ? "" : " (chưa xác minh)"}.</p>}
      {login?.released && <p className={styles.vi}>Số {login.phone} đã được người khác xác minh nên không còn dùng để đăng nhập. Thêm số mới bên dưới.</p>}
      {!hasLive && (
        <label className={styles.field}>
          <span>Số điện thoại</span>
          <input className={styles.input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      )}
      {hasLive && (
        <label className={styles.field}>
          <span>Mật khẩu hiện tại</span>
          <input className={styles.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label className={styles.field}>
        <span>Mật khẩu mới</span>
        <input className={styles.input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      {message && <p className={message.ok ? styles.muted : styles.bannerDanger} role={message.ok ? "status" : "alert"}>{message.text}</p>}
      <button className={styles.secondary} disabled={busy}>{hasLive ? "Đổi mật khẩu" : "Thêm số và mật khẩu"}</button>
    </form>
  );
}
