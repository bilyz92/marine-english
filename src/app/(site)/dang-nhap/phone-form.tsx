"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { DEVICES_KEY, NEXT_KEY, postJson, type Device } from "./api";
import { deviceLabel, getDeviceKey } from "./device-key";
import { RANKS } from "./ranks";
import { MESSAGE, WEAK } from "./phone-messages";

type Mode = "signup" | "login" | "forgot";
type Answer = { next?: string; error?: string; problem?: string; devices?: Device[]; ok?: boolean };

/** D2: tạo tài khoản, đăng nhập, quên mật khẩu bằng số điện thoại + mật khẩu. */
export function PhoneForm({ next, onDone }: { next: string; onDone: (created: boolean) => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [rank, setRank] = useState("");
  const [code, setCode] = useState("");
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (m: Mode) => { setMode(m); setError(null); setMustSetPassword(false); setResetSent(false); };

  function explain(answer: Answer): string {
    if (answer.error === "weak_password" || answer.next === "weak_password") return WEAK[answer.problem ?? ""] ?? "Mật khẩu chưa hợp lệ.";
    return MESSAGE[answer.error ?? answer.next ?? ""] ?? "Không thực hiện được, thử lại sau.";
  }

  /** Kết quả chung của đăng ký, đăng nhập, đặt lại: vào luôn, hoặc chọn máy để thay khi đã đủ 2 máy. */
  function finish(answer: Answer): boolean {
    if (answer.next === "done") {
      sessionStorage.removeItem(NEXT_KEY);
      onDone(mode === "signup");
      return true;
    }
    if (answer.next === "choose_device") {
      sessionStorage.setItem(DEVICES_KEY, JSON.stringify(answer.devices ?? []));
      sessionStorage.setItem(NEXT_KEY, next);
      router.push("/dang-nhap/chon-thiet-bi");
      return true;
    }
    return false;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!phone.trim()) return setError("Nhập số điện thoại.");
    if (mode === "signup" && !displayName.trim()) return setError("Nhập tên hiển thị.");
    setBusy(true);
    try {
      await send();
    } catch {
      setError(MESSAGE.network!);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const device = { deviceKey: await getDeviceKey(), deviceLabel: deviceLabel() };
    let reply: { status: number; data: Answer };
    if (mode === "signup") {
      reply = await postJson<Answer>("/api/auth/learner/password/register", {
        phone, password, displayName: displayName.trim(), rank: rank || null, ...device,
      });
    } else if (mode === "login") {
      reply = await postJson<Answer>("/api/auth/learner/password/login", {
        phone, password, ...(mustSetPassword ? { newPassword } : {}), ...device,
      });
    } else if (!resetSent) {
      reply = await postJson<Answer>("/api/auth/learner/password/reset/send", { phone });
      if (reply.status === 0) return setError(MESSAGE.network!);
      setError(null);
      return setResetSent(true);
    } else {
      reply = await postJson<Answer>("/api/auth/learner/password/reset/verify", { phone, code, newPassword, ...device });
      if (reply.data.next === "invalid") reply = { ...reply, data: { next: "invalid_code" } };
    }
    if (reply.status === 0) return setError(MESSAGE.network!);
    const answer = reply.data;
    if (finish(answer)) return;
    if (answer.next === "set_password") {
      setMustSetPassword(true);
      return setError(null);
    }
    setError(explain(answer));
  }

  return (
    <form onSubmit={submit}>
      <div className={styles.tabs}>
        <button type="button" className={mode === "login" ? styles.tabActive : styles.tab} onClick={() => switchMode("login")}>Đăng nhập</button>
        <button type="button" className={mode === "signup" ? styles.tabActive : styles.tab} onClick={() => switchMode("signup")}>Tạo tài khoản</button>
      </div>
      {mode === "forgot" && (
        <p className={styles.lead}>
          {resetSent
            ? "Nếu số này có email liên kết, mã đặt lại đã được gửi tới email đó. Mã có hiệu lực 5 phút."
            : "Mã đặt lại sẽ gửi tới email đã liên kết với tài khoản. Chưa liên kết email thì nhắn hỗ trợ để được cấp mật khẩu tạm."}
        </p>
      )}
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={styles.label}>Tên hiển thị</span>
          <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
        </label>
      )}
      <label className={styles.field}>
        <span className={styles.label}>Số điện thoại</span>
        <input className={styles.input} type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={mode === "forgot" && resetSent} />
      </label>
      {mode !== "forgot" && (
        <label className={styles.field}>
          <span className={styles.label}>{mustSetPassword ? "Mật khẩu tạm" : "Mật khẩu"}</span>
          <input className={styles.input} type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "signup" && <span className={styles.note}>Ít nhất 8 ký tự. Nên dùng một câu ngắn dễ nhớ.</span>}
        </label>
      )}
      {mode === "forgot" && resetSent && (
        <label className={styles.field}>
          <span className={styles.label}>Mã 6 chữ số</span>
          <input className={styles.input} inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        </label>
      )}
      {(mustSetPassword || (mode === "forgot" && resetSent)) && (
        <label className={styles.field}>
          <span className={styles.label}>Mật khẩu mới</span>
          <input className={styles.input} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          {mustSetPassword && <span className={styles.note}>Đây là mật khẩu tạm do hỗ trợ cấp. Đặt mật khẩu mới (ít nhất 8 ký tự) để tiếp tục.</span>}
        </label>
      )}
      {mode === "signup" && (
        <label className={styles.field}>
          <span className={styles.label}>Chức danh hiện tại</span>
          <select className={styles.input} value={rank} onChange={(e) => setRank(e.target.value)}>
            <option value="">Chọn chức danh</option>
            {RANKS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button className={styles.primary} disabled={busy}>
        {mode === "signup" ? "Tạo tài khoản" : mode === "login" ? (mustSetPassword ? "Đặt mật khẩu và vào" : "Đăng nhập") : resetSent ? "Đặt mật khẩu mới" : "Gửi mã đặt lại"}
      </button>
      {mode === "login" && <button type="button" className={styles.link} onClick={() => switchMode("forgot")}>Quên mật khẩu?</button>}
      {mode === "forgot" && <button type="button" className={styles.link} onClick={() => switchMode("login")}>← Quay lại đăng nhập</button>}
      <p className={styles.note}>Số điện thoại chỉ dùng để đăng nhập, chưa cần xác minh.</p>
    </form>
  );
}
