"use client";

import { useState } from "react";
import { ActionDialog, adminApi, can, Field, fmtTime, LoadState, problemOf, useAdmin, useLoad } from "../admin-lib";
import { KIND_LABEL, LearnerSearch, type Learner } from "../learner-search";
import styles from "../admin.module.css";

type Device = { id: string; label: string; registeredAt: string; lastSeenAt: string | null };

function Devices({ learner }: { learner: Learner }) {
  const me = useAdmin();
  const { data, reload, ...state } = useLoad<{ devices: Device[] }>(`/api/quan-tri/devices?userId=${learner.id}`);
  const [target, setTarget] = useState<Device | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/devices", { method: "DELETE", body: { deviceId: target!.id, reason } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setTarget(null);
    setReason("");
    await reload();
  }

  return (
    <>
      <h3 className={styles.h2}>Thiết bị</h3>
      <LoadState {...state} reload={reload} />
      {data?.devices.length === 0 && <p className={styles.muted}>Không có thiết bị nào đang dùng.</p>}
      {data?.devices.map((d) => (
        <div key={d.id} className={styles.item}>
          <div className={styles.itemText}><span>{d.label}</span><span className={styles.muted}>Dùng lần cuối {fmtTime(d.lastSeenAt)}</span></div>
          {can(me, "devices.remove") && <button className={styles.btn} onClick={() => { setProblem(null); setTarget(d); }}>Gỡ</button>}
        </div>
      ))}
      <ActionDialog open={target !== null} title={`Gỡ thiết bị “${target?.label}” của ${learner.displayName}?`} confirmLabel="Gỡ thiết bị" danger busy={busy} problem={problem} onClose={() => setTarget(null)} onConfirm={() => void remove()}>
        <p className={styles.muted}>Máy đó bị đăng xuất; bài đã tải trên máy không bị thu hồi ngay khi máy chưa có mạng.</p>
        <Field label="Lý do *"><textarea className={styles.input} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ActionDialog>
    </>
  );
}

/** D2: số + mật khẩu của học viên; chủ đặt mật khẩu tạm theo tiêu chí khôi phục G15 (lý do, bằng chứng, có nhật ký). */
function PasswordLogin({ learner }: { learner: Learner }) {
  const me = useAdmin();
  const login = learner.passwordLogin;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "", evidence: "", phone: "" });
  const [temporary, setTemporary] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [name]: e.target.value });

  async function reset() {
    setBusy(true);
    const r = await adminApi<{ temporaryPassword?: string }>(`/api/quan-tri/learners/${learner.id}/password`, {
      method: "POST", body: { reason: form.reason, evidence: form.evidence, ...(form.phone.trim() ? { phone: form.phone } : {}) },
    });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setOpen(false);
    setForm({ reason: "", evidence: "", phone: "" });
    setTemporary(r.data.temporaryPassword ?? null);
  }

  return (
    <>
      <h3 className={styles.h2}>Số điện thoại + mật khẩu</h3>
      {!login && <p className={styles.muted}>Chưa có.</p>}
      {login && (
        <div className={styles.item}>
          <span>{login.phone}</span>
          <span className={login.released ? styles.tagBad : styles.tag}>
            {login.released ? "Đã bị nhả (số được người khác xác minh)" : login.verified ? "Đã xác minh" : "Chưa xác minh"}{login.mustChange ? " · đang dùng mật khẩu tạm" : ""}
          </span>
        </div>
      )}
      {temporary && (
        <p className={styles.notice} role="status">
          Mật khẩu tạm: <strong className={styles.code}>{temporary}</strong>. Chỉ hiện một lần: đọc cho học viên, học viên phải đổi ngay khi đăng nhập.
        </p>
      )}
      {can(me, "learners.password_reset") && learner.status === "active" && (
        <div className={styles.actions}><button className={styles.btn} onClick={() => { setProblem(null); setTemporary(null); setOpen(true); }}>Đặt mật khẩu tạm</button></div>
      )}
      <ActionDialog open={open} title={`Đặt mật khẩu tạm cho ${learner.displayName}`} confirmLabel="Đặt mật khẩu tạm" danger busy={busy} problem={problem} onClose={() => setOpen(false)} onConfirm={() => void reset()}>
        <p className={styles.muted}>Chỉ làm khi đã xác minh đúng người: mã đơn, giao dịch chuyển khoản đã mua, thông tin hồ sơ. Mọi máy của học viên bị đăng xuất.</p>
        <Field label="Lý do *"><textarea className={styles.input} required value={form.reason} onChange={set("reason")} /></Field>
        <Field label="Bằng chứng đã đối chiếu *"><textarea className={styles.input} required value={form.evidence} onChange={set("evidence")} /></Field>
        <Field label={login && !login.released ? "Số mới (để trống nếu giữ số cũ)" : "Số điện thoại *"}><input className={styles.input} type="tel" value={form.phone} onChange={set("phone")} /></Field>
      </ActionDialog>
    </>
  );
}

export default function LearnersPage() {
  const [learners, setLearners] = useState<Learner[]>([]);
  return (
    <>
      <h1 className={styles.h1}>Học viên</h1>
      <section className={styles.card}><LearnerSearch onResults={setLearners} /></section>
      {learners.map((l) => (
        <section key={l.id} className={styles.card}>
          <h2 className={styles.h2}>{l.displayName}</h2>
          <p className={styles.muted}>{l.rank ?? "Chưa ghi chức danh"}{l.status !== "active" ? ` · ${l.status === "merged" ? "Đã gộp vào tài khoản khác" : "Đã khóa"}` : ""}</p>
          {l.identities.map((i) => <div key={i.kind + i.value} className={styles.item}><span className={styles.muted}>{KIND_LABEL[i.kind] ?? i.kind}</span><span>{i.value}</span></div>)}
          <h3 className={styles.h2}>Khóa đang có</h3>
          {l.courses.length === 0 && <p className={styles.muted}>Chưa có khóa nào.</p>}
          {l.courses.map((c) => <div key={c.enrollmentId} className={styles.item}><span>{c.title}</span><span className={styles.tag}>{c.source === "order" ? "Đã mua" : "Cấp không thu tiền"}</span></div>)}
          <PasswordLogin learner={l} />
          <Devices learner={l} />
        </section>
      ))}
    </>
  );
}
