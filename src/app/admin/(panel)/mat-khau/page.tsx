"use client";

import { useContext, useState } from "react";
import { AdminReloadContext, adminApi, Field, useAdmin } from "../admin-lib";
import styles from "../admin.module.css";

// D3: quản trị đặt hoặc đổi mật khẩu của chính mình. Cần đăng nhập trong 10 phút gần đây; các phiên khác bị đăng xuất.

const WEAK: Record<string, string> = {
  too_short: "Mật khẩu cần ít nhất 8 ký tự.",
  too_long: "Mật khẩu dài quá 128 ký tự.",
  common: "Mật khẩu này quá dễ đoán, chọn mật khẩu khác.",
  email: "Không dùng email làm mật khẩu.",
};

export default function AdminPasswordPage() {
  const me = useAdmin();
  const reloadMe = useContext(AdminReloadContext);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (password !== again) return setProblem("Hai lần nhập mật khẩu không giống nhau.");
    setBusy(true);
    setProblem(null);
    const r = await adminApi<{ problem?: string }>("/api/quan-tri/me/password", { method: "POST", body: { password } });
    setBusy(false);
    if (r.ok) {
      setDone(true);
      reloadMe();
      setPassword("");
      setAgain("");
      return;
    }
    if (r.data.error === "weak_password") return setProblem(WEAK[r.data.problem ?? ""] ?? "Mật khẩu chưa hợp lệ.");
    if (r.data.error === "reauth_required") return setProblem("Vì an toàn, cần đăng nhập lại (trong 10 phút gần đây) rồi mới đặt được mật khẩu. Đăng xuất rồi đăng nhập lại.");
    setProblem(r.data.error ?? "Có lỗi, thử lại sau.");
  }

  return (
    <>
      <h1 className={styles.h1}>Mật khẩu</h1>
      <form className={styles.card} onSubmit={(e) => void save(e)}>
        <p className={styles.muted}>
          {me?.hasPassword || done ? "Đổi mật khẩu đăng nhập quản trị." : "Đặt mật khẩu để lần sau đăng nhập bằng email + mật khẩu."} Tài khoản: <b>{me?.email}</b>.
          Sau khi lưu, các máy khác đang đăng nhập tài khoản này sẽ bị đăng xuất.
        </p>
        <Field label="Mật khẩu mới (ít nhất 8 ký tự)"><input className={styles.input} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Nhập lại mật khẩu mới"><input className={styles.input} type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
        {problem && <p className={styles.error} role="alert">{problem}</p>}
        {done && <p className={styles.ok} role="status">Đã lưu mật khẩu. Lần sau đăng nhập bằng email + mật khẩu.</p>}
        <div className={styles.actions}><button className={styles.btnMain} disabled={busy}>{busy ? "Đang lưu…" : "Lưu mật khẩu"}</button></div>
      </form>
    </>
  );
}
