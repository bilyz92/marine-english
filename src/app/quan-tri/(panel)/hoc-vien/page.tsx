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
          <Devices learner={l} />
        </section>
      ))}
    </>
  );
}
