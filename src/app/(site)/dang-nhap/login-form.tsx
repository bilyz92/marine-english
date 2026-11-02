"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { DEVICES_KEY, NEXT_KEY, postJson, type VerifyResult } from "./api";
import { deviceLabel, getDeviceKey } from "./device-key";
import { PhoneForm } from "./phone-form";
import { RANKS } from "./ranks";

type Mode = "signup" | "login";

const RESEND_SECONDS = 60;

export function LoginForm({ zaloEnabled, googleFailed, next, google: googleOn, email }: { zaloEnabled: boolean; googleFailed: boolean; next: string; google: boolean; email: boolean }) {
  const router = useRouter();
  // D2: số điện thoại + mật khẩu là cách chính; email (mã 6 số) và Google vẫn dùng được.
  const [method, setMethod] = useState<"phone" | "email">("phone");
  const [mode, setMode] = useState<Mode>("signup");
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [displayName, setDisplayName] = useState("");
  const [contact, setContact] = useState("");
  const [rank, setRank] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(googleFailed ? "Đăng nhập Google không thành công. Thử lại hoặc dùng email." : null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

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
    setResendIn(RESEND_SECONDS);
    setStep("code");
  }

  async function resend() {
    setBusy(true);
    const { status, data } = await postJson<{ error?: string }>("/api/auth/learner/otp/send", { contact, ...profile });
    setBusy(false);
    if (status !== 200) return setError(data.error ?? "Không gửi được mã, thử lại sau.");
    setError(null);
    setResendIn(RESEND_SECONDS);
  }

  function openLearning() {
    // Tải lại toàn trang: app học dựng lại dữ liệu offline theo người dùng mới.
    window.location.assign(next);
  }

  async function google() {
    setBusy(true);
    sessionStorage.setItem(NEXT_KEY, next);
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
    // Đăng nhập bằng mã xong thì về `next` của trang này; bỏ giá trị cũ để /hoc không nhảy sang trang cũ sau này.
    if (data.next === "done") {
      sessionStorage.removeItem(NEXT_KEY);
      return setStep("done");
    }
    if (data.next === "choose_device") {
      sessionStorage.setItem(DEVICES_KEY, JSON.stringify(data.devices ?? []));
      sessionStorage.setItem(NEXT_KEY, next);
      return router.push("/dang-nhap/chon-thiet-bi");
    }
    setError(data.error ?? "Mã không đúng hoặc đã hết hạn. Kiểm tra lại hoặc gửi mã mới.");
  }

  if (step === "done") {
    return (
      <div>
        <h2 className={styles.title}>{mode === "signup" ? "Đã tạo tài khoản" : "Đã đăng nhập"}</h2>
        <p className={styles.lead}>Quyền lợi đã mở trong tài khoản.</p>
        <button className={styles.primary} onClick={openLearning}>Tiếp tục</button>
      </div>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={verify}>
        <h2 className={styles.title}>Nhập mã xác minh</h2>
        <p className={styles.lead}>Nếu thông tin đúng, mã đã được gửi qua {contact.includes("@") ? "email" : "Zalo"} tới {contact}. Mã có hiệu lực 5 phút.</p>
        <div className={styles.field}>
          <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Mã 6 chữ số" aria-invalid={Boolean(error)} />
          {error && <span className={styles.error}>{error}</span>}
        </div>
        <button className={styles.primary} disabled={busy}>Xác minh</button>
        <button type="button" className={styles.link} disabled={busy || resendIn > 0} onClick={resend}>
          {resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : "Gửi lại mã"}
        </button>
        <p className={styles.note}>Gửi nhiều lần có thể bị giới hạn, đợi ít phút rồi thử lại.</p>
        <button type="button" className={styles.link} onClick={() => { setStep("form"); setCode(""); setError(null); }}>
          ← Đổi cách liên hệ
        </button>
      </form>
    );
  }

  // Cách chưa bật (Google chưa có Client ID, email chưa có nhà cung cấp) thì ẩn, không để khách bấm vào lỗi.
  const methods = email && (
    <div className={styles.tabs} role="group" aria-label="Cách đăng nhập">
      <button type="button" className={method === "phone" ? styles.tabActive : styles.tab} aria-pressed={method === "phone"} onClick={() => { setMethod("phone"); setError(null); }}>Số điện thoại</button>
      <button type="button" className={method === "email" ? styles.tabActive : styles.tab} aria-pressed={method === "email"} onClick={() => { setMethod("email"); setError(null); }}>Email</button>
    </div>
  );
  const googleButton = googleOn && <button type="button" className={styles.secondary} disabled={busy} onClick={google}>Tiếp tục với Google</button>;

  if (method === "phone") {
    return (
      <div>
        {methods}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <PhoneForm next={next} onDone={(created) => { setMode(created ? "signup" : "login"); setStep("done"); }} />
        {googleOn && <div className={styles.divider}>hoặc</div>}
        {googleButton}
      </div>
    );
  }

  return (
    <form onSubmit={sendCode}>
      {methods}
      <div className={styles.tabs}>
        <button type="button" className={mode === "signup" ? styles.tabActive : styles.tab} onClick={() => setMode("signup")}>Tạo tài khoản</button>
        <button type="button" className={mode === "login" ? styles.tabActive : styles.tab} onClick={() => setMode("login")}>Đăng nhập</button>
      </div>
      {googleButton}
      {googleOn && <div className={styles.divider}>hoặc</div>}
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={styles.label}>Tên hiển thị</span>
          <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.label}>Email</span>
        <input className={styles.input} type="email" autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} />
        {zaloEnabled
          ? <span className={styles.note}>Không dùng Zalo? Đăng nhập bằng email hoặc Google.</span>
          : <span className={styles.note}>Đăng nhập bằng số điện thoại qua Zalo sẽ mở sau.</span>}
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
