"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import styles from "./admin-login.module.css";
import { postJson } from "../../(site)/dang-nhap/api";

// Link đăng nhập mang token sau dấu # (không gửi lên máy chủ): đọc một lần rồi xóa khỏi thanh địa chỉ và lịch sử.
let capturedToken: string | null | undefined;
function captureLinkToken(): string | null {
  if (capturedToken === undefined) {
    capturedToken = new URLSearchParams(window.location.hash.slice(1)).get("link");
    if (capturedToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return capturedToken;
}
const noSubscription = () => () => {};

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function AdminLogin({ googleFailed, google, email }: { googleFailed: boolean; google: boolean; email: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = useSyncExternalStore(noSubscription, captureLinkToken, () => null);
  const [error, setError] = useState<string | null>(googleFailed ? "Đăng nhập Google không thành công, hoặc email này chưa được cấp quyền quản trị." : null);

  async function startGoogle() {
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ redirectUrl?: string }>("/api/auth/admin/google/start", {});
    if (status === 200 && data.redirectUrl) return window.location.assign(data.redirectUrl);
    setBusy(false);
    setError(status === 0 ? "Không kết nối được. Kiểm tra mạng rồi bấm lại." : "Không mở được đăng nhập Google, thử lại sau.");
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim()) return setError("Nhập email quản trị.");
    setBusy(true);
    setError(null);
    const { status } = await postJson("/api/auth/admin/link/send", { email: address.trim() });
    setBusy(false);
    if (status === 200) return setSent(true);
    setError(status === 0 ? "Không kết nối được. Kiểm tra mạng rồi bấm lại." : "Chưa gửi được link, thử lại sau ít phút.");
  }

  async function useLink() {
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ next: string }>("/api/auth/admin/link/consume", { token: link });
    if (data?.next === "done") return router.push("/admin");
    setBusy(false);
    setError(status === 0 ? "Không kết nối được. Kiểm tra mạng rồi bấm lại." : "Link đã dùng hoặc đã hết hạn. Xin link mới.");
  }

  const alert = error && <p className={styles.error} role="alert">{error}</p>;

  if (link) {
    return (
      <>
        <h1 className={styles.title}>Xác nhận đăng nhập</h1>
        <p className={styles.lead}>Bấm nút dưới đây để vào trang quản trị. Link chỉ dùng được một lần.</p>
        {alert}
        <button className={styles.primary} disabled={busy} onClick={useLink}>{busy ? "Đang đăng nhập…" : "Vào trang quản trị"}</button>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Đăng nhập quản trị</h1>
      <p className={styles.lead}>Chỉ dành cho email đã được chủ tài khoản cấp quyền.</p>
      {alert}
      {google && (
        <button type="button" className={styles.google} disabled={busy} onClick={startGoogle}>
          <GoogleMark /> Đăng nhập bằng Google
        </button>
      )}
      {google && email && <div className={styles.divider}>hoặc nhận link qua email</div>}
      {email && (sent ? (
        <p className={styles.success} role="status">Nếu email này có quyền quản trị, link đăng nhập (hiệu lực 15 phút) đã được gửi tới hộp thư.</p>
      ) : (
        <form onSubmit={sendLink}>
          <label className={styles.field}>
            <span className={styles.label}>Email quản trị</span>
            <input className={styles.input} type="email" required autoComplete="email" inputMode="email" placeholder="ten@vidu.com"
              value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <button className={styles.primary} disabled={busy}>{busy ? "Đang gửi…" : "Gửi link đăng nhập"}</button>
        </form>
      ))}
      {!google && !email && (
        <div className={styles.notice}>
          <p><strong>Đăng nhập Google và gửi link qua email chưa bật.</strong></p>
          <p>Trong lúc chờ, nhờ người quản lý máy chủ in link đăng nhập bằng lệnh <code>admin:login-link</code> (xem runbook). Link dùng một lần, trong 15 phút.</p>
        </div>
      )}
      {!google && email && <p className={styles.hint}>Đăng nhập Google chưa bật.</p>}
    </>
  );
}
