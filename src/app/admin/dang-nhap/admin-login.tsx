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

const NETWORK = "Không kết nối được. Kiểm tra mạng rồi bấm lại.";
const MESSAGE: Record<string, string> = {
  invalid: "Email hoặc mật khẩu không đúng.",
  locked: "Sai quá nhiều lần. Đợi 15 phút rồi thử lại.",
};

/** D3: email + mật khẩu là cách chính; Google và link email chỉ hiện khi đã bật. Không có tạo tài khoản. */
export function AdminLogin({ googleFailed, google, email }: { googleFailed: boolean; google: boolean; email: boolean }) {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const link = useSyncExternalStore(noSubscription, captureLinkToken, () => null);
  const [error, setError] = useState<string | null>(googleFailed ? "Đăng nhập Google không thành công, hoặc email này chưa được cấp quyền quản trị." : null);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!address.trim() || !password) return setError("Nhập email và mật khẩu.");
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ next?: string }>("/api/auth/admin/password/login", { email: address.trim(), password });
    if (data?.next === "done") return router.push("/admin");
    setBusy(false);
    setError(status === 0 ? NETWORK : MESSAGE[data?.next ?? ""] ?? "Không đăng nhập được, thử lại sau.");
  }

  async function startGoogle() {
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ redirectUrl?: string }>("/api/auth/admin/google/start", {});
    if (status === 200 && data.redirectUrl) return window.location.assign(data.redirectUrl);
    setBusy(false);
    setError(status === 0 ? NETWORK : "Không mở được đăng nhập Google, thử lại sau.");
  }

  async function sendLink() {
    if (!address.trim()) return setError("Nhập email quản trị.");
    setBusy(true);
    setError(null);
    const { status } = await postJson("/api/auth/admin/link/send", { email: address.trim() });
    setBusy(false);
    if (status === 200) return setSent(true);
    setError(status === 0 ? NETWORK : "Chưa gửi được link, thử lại sau ít phút.");
  }

  async function useLink() {
    setBusy(true);
    setError(null);
    const { status, data } = await postJson<{ next: string }>("/api/auth/admin/link/consume", { token: link });
    if (data?.next === "done") return router.push("/admin");
    setBusy(false);
    setError(status === 0 ? NETWORK : "Link đã dùng hoặc đã hết hạn. Xin link mới.");
  }

  if (link) {
    return (
      <>
        <h1 className={styles.title}>Xác nhận đăng nhập</h1>
        <p className={styles.lead}>Bấm nút dưới đây để vào trang quản trị. Link chỉ dùng được một lần.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primary} disabled={busy} onClick={useLink}>{busy ? "Đang đăng nhập…" : "Vào trang quản trị"}</button>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Đăng nhập quản trị</h1>
      <p className={styles.lead}>Dành cho chủ và người hỗ trợ đã được cấp quyền. Tài khoản quản trị do chủ mời, không tự tạo.</p>
      <form onSubmit={signIn}>
        <label className={styles.field}>
          <span className={styles.label}>Email</span>
          <input className={styles.input} type="email" autoComplete="username" inputMode="email" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Mật khẩu</span>
          <input className={styles.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button className={styles.primary} disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button>
      </form>
      <button type="button" className={styles.link} onClick={() => setForgot(!forgot)}>Quên mật khẩu?</button>
      {forgot && (
        <p className={styles.note}>
          {email
            ? "Gửi link đăng nhập tới email quản trị (nút bên dưới), vào bằng link rồi đặt mật khẩu mới ở mục Mật khẩu."
            : "Nhờ chủ hoặc người quản lý máy chủ in link đăng nhập (lệnh admin:login-link), vào bằng link rồi đặt mật khẩu mới ở mục Mật khẩu."}
        </p>
      )}
      {(google || email) && <div className={styles.divider}>hoặc</div>}
      {google && <button type="button" className={styles.secondary} disabled={busy} onClick={startGoogle}>Tiếp tục với Google</button>}
      {email && (sent
        ? <p className={styles.note} role="status">Nếu email này có quyền quản trị, link đăng nhập (hiệu lực 15 phút) đã được gửi tới hộp thư.</p>
        : <button type="button" className={styles.secondary} disabled={busy} onClick={() => void sendLink()}>Gửi link đăng nhập qua email</button>)}
      <p className={styles.note}>Lần đầu vào bằng link? Đặt mật khẩu ở mục Mật khẩu trong trang quản trị để lần sau dùng email + mật khẩu.</p>
    </>
  );
}
