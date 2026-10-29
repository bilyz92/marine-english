"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { DEVICES_KEY, postJson, type VerifyResult } from "./api";
import { deviceLabel, getDeviceKey } from "./device-key";

const RANKS = [
  "Máy trưởng", "Máy hai", "Máy ba", "Máy tư", "Thợ cả", "Thợ máy",
  "Thực tập sinh máy", "Bộ phận boong", "Đang học trường hàng hải", "Khác / chưa xác định",
];

type Mode = "signup" | "login";

export function LoginForm({ zaloEnabled, googleFailed }: { zaloEnabled: boolean; googleFailed: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [rank, setRank] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(googleFailed ? "Đăng nhập Google không thành công. Thử lại hoặc dùng email." : null);
  const [busy, setBusy] = useState(false);

  const profile = mode === "signup" ? { displayName: displayName.trim(), rank: rank || null } : {};

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "signup" && !displayName.trim()) return setError("Nhập tên hiển thị.");
    if (!contact.trim()) return setError("Nhập email.");
    setBusy(true);
    const { status, data } = await postJson<{ error?: string }>("/api/auth/learner/otp/send", { contact, ...profile });
    setBusy(false);
    if (status !== 200) return setError(data.error ?? "Không gửi được mã, thử lại sau.");
    setError(null);
    setStep("code");
  }

  async function google() {
    setBusy(true);
    const { status, data } = await postJson<{ redirectUrl?: string }>("/api/auth/learner/google/start", {
      deviceKey: await getDeviceKey(), deviceLabel: deviceLabel(),
    });
    if (status === 200 && data.redirectUrl) return window.location.assign(data.redirectUrl);
    setBusy(false);
    setError("Không mở được đăng nhập Google, thử lại sau.");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Mã gồm 6 chữ số.");
    setBusy(true);
    const { data } = await postJson<VerifyResult>("/api/auth/learner/otp/verify", {
      contact, code, deviceKey: await getDeviceKey(), deviceLabel: deviceLabel(), ...profile,
    });
    setBusy(false);
    if (data.next === "done") return setStep("done");
    if (data.next === "choose_device") {
      sessionStorage.setItem(DEVICES_KEY, JSON.stringify(data.devices ?? []));
      return router.push("/dang-nhap/chon-thiet-bi");
    }
    setError(data.error ?? "Mã không đúng hoặc đã hết hạn. Kiểm tra lại hoặc gửi mã mới.");
  }

  if (step === "done") {
    return (
      <div>
        <h2 className={styles.title}>{mode === "signup" ? "Đã tạo tài khoản" : "Đã đăng nhập"}</h2>
        <p className={styles.lead}>Quyền lợi đã mở trong tài khoản.</p>
        <button className={styles.primary} onClick={() => router.push("/")}>Để sau, vào khóa học của tôi</button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={verify}>
        <h2 className={styles.title}>Nhập mã xác minh</h2>
        <p className={styles.lead}>Mã gửi tới {contact}. Mã có hiệu lực 5 phút.</p>
        <div className={styles.field}>
          <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Mã 6 chữ số" />
          {error && <span className={styles.error}>{error}</span>}
        </div>
        <button className={styles.primary} disabled={busy}>Xác minh</button>
        <button type="button" className={styles.link} onClick={() => { setStep("form"); setCode(""); setError(null); }}>
          ← Đổi cách liên hệ
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode}>
      <div className={styles.tabs}>
        <button type="button" className={mode === "signup" ? styles.tabActive : styles.tab} onClick={() => setMode("signup")}>Tạo tài khoản</button>
        <button type="button" className={mode === "login" ? styles.tabActive : styles.tab} onClick={() => setMode("login")}>Đăng nhập</button>
      </div>
      <button type="button" className={styles.secondary} disabled={busy} onClick={google}>Tiếp tục với Google</button>
      <div className={styles.divider}>hoặc</div>
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={styles.label}>Tên hiển thị</span>
          <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input className={styles.input} type="email" autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} />
        {!zaloEnabled && <span className={styles.note}>Đăng nhập bằng số điện thoại qua Zalo sẽ mở sau.</span>}
      </label>
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={styles.label}>Chức danh hiện tại</span>
          <select className={styles.input} value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">Chọn chức danh</option>
            {RANKS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      )}
      {error && <p className={styles.error}>{error}</p>}
      <button className={styles.primary} disabled={busy}>Gửi mã xác minh</button>
    </form>
  );
}
