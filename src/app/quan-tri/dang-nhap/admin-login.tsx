"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import styles from "../../(site)/dang-nhap/login.module.css";
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

export function AdminLogin({ googleFailed }: { googleFailed: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = useSyncExternalStore(noSubscription, captureLinkToken, () => null);

  const [error, setError] = useState<string | null>(googleFailed ? "Đăng nhập Google không thành công hoặc email chưa được cấp quyền." : null);

  async function google() {
    setBusy(true);
    const { status, data } = await postJson<{ redirectUrl?: string }>("/api/auth/admin/google/start", {});
    if (status === 200 && data.redirectUrl) return window.location.assign(data.redirectUrl);
    setBusy(false);
    setError("Không mở được đăng nhập Google, thử lại sau.");
  }

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    await postJson("/api/auth/admin/link/send", { email });
    setBusy(false);
    setSent(true);
  }

  async function useLink() {
    setBusy(true);
    const { data } = await postJson<{ next: string }>("/api/auth/admin/link/consume", { token: link });
    setBusy(false);
    if (data.next === "done") return router.push("/quan-tri");
    setError("Link đã dùng hoặc đã hết hạn. Gửi link mới.");
  }

  if (link) {
    return (
      <div>
        <p className={styles.lead}>Bấm nút dưới đây để đăng nhập khu vực quản trị.</p>
        {error && <p className={styles.error}>{error}</p>}
        <button className={styles.primary} disabled={busy} onClick={useLink}>Đăng nhập</button>
      </div>
    );
  }

  return (
    <div>
      <button className={styles.secondary} disabled={busy} onClick={google}>Đăng nhập bằng Google</button>
      <div className={styles.divider}>hoặc nhận link qua email</div>
      {sent ? (
        <p className={styles.lead}>Nếu email này có quyền quản trị, link đăng nhập (hiệu lực 15 phút) đã được gửi tới hộp thư.</p>
      ) : (
        <form onSubmit={sendLink}>
          <label className={styles.field}>
            <span className={styles.label}>Email quản trị</span>
            <input className={styles.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button className={styles.primary} disabled={busy}>Gửi link đăng nhập</button>
        </form>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
