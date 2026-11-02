"use client";

import { useState } from "react";
import { ActionDialog, adminApi, Field, fmtTime, LoadState, problemOf, useLoad } from "../admin-lib";
import styles from "../admin.module.css";

type Admin = { id: string; email: string; role: string; status: string; inviteExpiresAt: string | null };
const ROLE: Record<string, string> = { owner: "Chủ", support: "Hỗ trợ" };
const STATUS: Record<string, string> = { invited: "Đã mời", active: "Đang hoạt động", expired: "Hết hạn", revoked: "Đã thu hồi" };

export default function AdminsPage() {
  const { data, reload, ...state } = useLoad<{ admins: Admin[] }>("/api/quan-tri/admins");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support");
  const [change, setChange] = useState<{ admin: Admin; body: { role?: string; status?: string }; label: string; danger?: boolean } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [inviteProblem, setInviteProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const r = await adminApi("/api/quan-tri/admins", { method: "POST", body: { email, role } });
    setBusy(false);
    setInviteProblem(problemOf(r));
    if (r.ok) {
      setEmail("");
      await reload();
    }
  }

  async function apply() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/admins", { method: "PATCH", body: { adminId: change!.admin.id, ...change!.body } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setChange(null);
    await reload();
  }

  const ask = (admin: Admin, body: { role?: string; status?: string }, label: string, danger = false) => { setProblem(null); setChange({ admin, body, label, danger }); };

  return (
    <>
      <h1 className={styles.h1}>Quản trị viên</h1>
      <LoadState {...state} reload={reload} />
      {data && (
        <>
          <form className={styles.card} onSubmit={invite}>
            <h2 className={styles.h2}>Mời quản trị viên</h2>
            <Field label="Email *"><input className={styles.input} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Vai trò"><select className={styles.input} value={role} onChange={(e) => setRole(e.target.value)}><option value="support">Hỗ trợ</option><option value="owner">Chủ</option></select></Field>
            {inviteProblem && <p className={styles.error} role="alert">{inviteProblem}</p>}
            <div className={styles.actions}><button className={styles.btnMain} disabled={busy}>Gửi lời mời</button></div>
          </form>
          <section className={styles.card}>
            {data.admins.map((a) => (
              <div key={a.id} className={styles.item}>
                <div className={styles.itemText}><span>{a.email}</span><span className={styles.muted}>{ROLE[a.role] ?? a.role}{a.status === "invited" ? ` · hạn ${fmtTime(a.inviteExpiresAt)}` : ""}</span></div>
                <span className={a.status === "active" ? styles.tagOk : styles.tag}>{STATUS[a.status] ?? a.status}</span>
                {a.status !== "revoked" && (
                  <div className={styles.actions}>
                    <button className={styles.btn} onClick={() => ask(a, { role: a.role === "owner" ? "support" : "owner" }, a.role === "owner" ? "Hạ xuống Hỗ trợ" : "Nâng lên Chủ")}>{a.role === "owner" ? "Hạ xuống Hỗ trợ" : "Nâng lên Chủ"}</button>
                    <button className={styles.btn} onClick={() => ask(a, { status: "revoked" }, "Thu hồi", true)}>Thu hồi</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
      <ActionDialog open={change !== null} title={`${change?.label ?? ""}: ${change?.admin.email ?? ""}?`} confirmLabel={change?.label ?? ""} danger={change?.danger} busy={busy} problem={problem} onClose={() => setChange(null)} onConfirm={() => void apply()}>
        <p className={styles.muted}>Thay đổi có hiệu lực ngay và được ghi vào nhật ký.</p>
      </ActionDialog>
    </>
  );
}
