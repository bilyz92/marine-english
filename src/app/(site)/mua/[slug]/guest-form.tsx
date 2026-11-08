"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEVICES_KEY, NEXT_KEY, postJson, type Device } from "../../dang-nhap/api";
import { deviceLabel, getDeviceKey } from "../../dang-nhap/device-key";
import { MESSAGE, WEAK } from "../../dang-nhap/phone-messages";
import styles from "./buy.module.css";
import ui from "@/components/ui.module.css";

// Khách chưa có tài khoản mua ngay (docs/superpowers/plans/2026-11-05-guest-checkout.md): tên + số (email tùy chọn) →
// tài khoản tự tạo (mật khẩu tạm hiện ở bước 3 và gửi email khi thanh toán xong); số đã có tài khoản → nhập mật khẩu và mua tiếp trên trang này.

type Answer = { next?: string; error?: string; problem?: string; devices?: Device[] };
type Step = "form" | "login" | "email_taken";

export function GuestForm({ slug, terms, termsAccepted, onBlocked, onSignedIn }: {
  slug: string; terms: React.ReactNode; termsAccepted: boolean; onBlocked: () => void; onSignedIn: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loginHref = `/dang-nhap?next=${encodeURIComponent(`/mua/${slug}`)}`;

  /** Đã đủ 2 máy: sang chọn máy thay, xong quay về trang mua. */
  function chooseDevice(answer: Answer) {
    sessionStorage.setItem(DEVICES_KEY, JSON.stringify(answer.devices ?? []));
    sessionStorage.setItem(NEXT_KEY, `/mua/${slug}`);
    router.push("/dang-nhap/chon-thiet-bi");
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch {
      setError(MESSAGE.network!);
    } finally {
      setBusy(false);
    }
  }

  const register = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Nhập họ và tên.");
    if (!phone.trim()) return setError("Nhập số điện thoại.");
    // Email gõ sai thì thư có mật khẩu tạm tới người lạ: phải nhập lại cho khớp.
    if (email.trim() && email.trim().toLowerCase() !== emailConfirm.trim().toLowerCase()) return setError("Hai lần nhập email chưa giống nhau.");
    if (!termsAccepted) return onBlocked();
    return run(async () => {
      const r = await postJson<Answer>("/api/auth/learner/password/quick-register", {
        displayName: name.trim(), phone, ...(email.trim() ? { email: email.trim(), emailConfirm: emailConfirm.trim() } : {}), deviceKey: await getDeviceKey(), deviceLabel: deviceLabel(),
      });
      if (r.status === 0) return setError(MESSAGE.network!);
      // Chủ 09/11/2026: mật khẩu tạm không hiện ở bước này; hiện ở bước 3 và gửi email khi thanh toán xong.
      if (r.data.next === "done") return onSignedIn();
      if (r.data.next === "choose_device") return chooseDevice(r.data);
      if (r.data.error === "phone_taken") return setStep("login");
      if (r.data.error === "email_taken") return setStep("email_taken");
      if (r.data.error === "invalid_email") return setError("Email không đúng dạng. Bỏ trống nếu không dùng email.");
      if (r.data.error === "email_mismatch") return setError("Hai lần nhập email chưa giống nhau.");
      setError(MESSAGE[r.data.error ?? ""] ?? "Không tạo được tài khoản, thử lại sau.");
    });
  };

  const login = (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) return setError("Nhập mật khẩu.");
    if (!termsAccepted) return onBlocked();
    return run(async () => {
      const r = await postJson<Answer>("/api/auth/learner/password/login", {
        phone, password, ...(mustSetPassword ? { newPassword } : {}), deviceKey: await getDeviceKey(), deviceLabel: deviceLabel(),
      });
      if (r.status === 0) return setError(MESSAGE.network!);
      if (r.data.next === "done") return onSignedIn();
      if (r.data.next === "choose_device") return chooseDevice(r.data);
      if (r.data.next === "set_password") {
        setMustSetPassword(true);
        return setError("Đây là mật khẩu tạm. Đặt mật khẩu mới để mua tiếp.");
      }
      if (r.data.error === "weak_password" || r.data.next === "weak_password") return setError(WEAK[r.data.problem ?? ""] ?? "Mật khẩu mới chưa hợp lệ.");
      setError(MESSAGE[r.data.error ?? r.data.next ?? ""] ?? "Không đăng nhập được, thử lại sau.");
    });
  };

  if (step === "email_taken") {
    return (
      <div className={ui.notice} role="alert">
        <p>Email này đã có tài khoản. Đăng nhập tài khoản đó để mua tiếp.</p>
        <p><Link href={loginHref}>Đăng nhập bằng email</Link> · <button type="button" className={styles.linkButton} onClick={() => { setEmail(""); setEmailConfirm(""); setStep("form"); }}>Dùng không email</button></p>
        <p className={ui.muted}>Không đăng nhập được? <Link href="/lien-he">Liên hệ hỗ trợ</Link>.</p>
      </div>
    );
  }

  if (step === "login") {
    return (
      <form className={styles.guest} onSubmit={login}>
        <p className={ui.notice} role="status">Số {phone} đã có tài khoản. Nhập mật khẩu để mua tiếp.</p>
        <label className={styles.field}>
          <span>Mật khẩu</span>
          <input className={styles.input} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {mustSetPassword && (
          <label className={styles.field}>
            <span>Mật khẩu mới (ít nhất 8 ký tự)</span>
            <input className={styles.input} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
        )}
        {terms}
        {error && <p className={ui.error} role="alert">{error}</p>}
        <button className={ui.action} disabled={busy}>{busy ? "Đang kiểm tra…" : "Đăng nhập và mua tiếp"}</button>
        <p className={ui.muted}>
          <Link href={loginHref}>Đăng nhập cách khác</Link> · <Link href={loginHref}>Quên mật khẩu?</Link> ·{" "}
          <button type="button" className={styles.linkButton} onClick={() => { setStep("form"); setPassword(""); setError(null); }}>Dùng số khác</button>
        </p>
        <p className={ui.muted}>Không nhớ mật khẩu, hoặc không đăng nhập được? <Link href="/lien-he">Liên hệ hỗ trợ</Link>.</p>
      </form>
    );
  }

  return (
    <form className={styles.guest} onSubmit={register}>
      <label className={styles.field}>
        <span>Họ và tên *</span>
        <input className={styles.input} autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Số điện thoại *</span>
        <input className={styles.input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <small className={ui.muted}>Dùng số này để đăng nhập lần sau.</small>
      </label>
      <label className={styles.field}>
        <span>Email (không bắt buộc)</span>
        <input className={styles.input} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <small className={ui.muted}>Nhận thông tin đăng nhập khi thanh toán xong. Không có email thì xem ở bước 3.</small>
      </label>
      {email.trim() && (
        <label className={styles.field}>
          <span>Nhập lại email</span>
          <input className={styles.input} type="email" autoComplete="off" value={emailConfirm} onChange={(e) => setEmailConfirm(e.target.value)} />
        </label>
      )}
      {terms}
      {error && <p className={ui.error} role="alert">{error}</p>}
      <button className={ui.action} disabled={busy}>{busy ? "Đang tạo tài khoản…" : "Tạo tài khoản và tiếp tục"}</button>
      <p className={ui.muted}>Đã có tài khoản? <Link href={loginHref}>Đăng nhập</Link></p>
    </form>
  );
}
