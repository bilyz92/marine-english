"use client";

import { useState } from "react";
import { ActionDialog, adminApi, Field, messageFor, problemOf } from "../admin-lib";
import { KIND_LABEL, LearnerSearch, type Learner } from "../learner-search";
import styles from "../admin.module.css";

type Preview = { identities: { kind: string; value: string }[]; activeEnrollments: number; orders: number };

function Picker({ title, value, onPick }: { title: string; value: Learner | null; onPick: (l: Learner) => void }) {
  const [list, setList] = useState<Learner[]>([]);
  return (
    <section className={styles.card}>
      <h2 className={styles.h2}>{title}{value ? `: ${value.displayName}` : ""}</h2>
      <LearnerSearch label={`Tìm ${title.toLowerCase()}`} onResults={setList} />
      {list.map((l) => (
        <div key={l.id} className={styles.item}>
          <div className={styles.itemText}><span>{l.displayName}</span><span className={styles.muted}>{l.identities.map((i) => `${KIND_LABEL[i.kind] ?? i.kind}: ${i.value}`).join(" · ")}</span></div>
          <button className={styles.btn} aria-pressed={value?.id === l.id} onClick={() => onPick(l)}>{value?.id === l.id ? "Đã chọn" : "Chọn"}</button>
        </div>
      ))}
    </section>
  );
}

export default function MergePage() {
  const [source, setSource] = useState<Learner | null>(null);
  const [target, setTarget] = useState<Learner | null>(null);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(isPreview: boolean) {
    setBusy(true);
    const r = await adminApi<{ preview?: Preview; result?: string }>("/api/quan-tri/merges", { method: "POST", body: { sourceUserId: source!.id, targetUserId: target!.id, reason, preview: isPreview } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue ?? messageFor(r.data.error));
    setProblem(null);
    if (isPreview) return setPreview(r.data.preview ?? null);
    setDone(`Đã gộp ${source!.displayName} vào ${target!.displayName}.`);
    setPreview(null);
    setSource(null);
    setTarget(null);
    setReason("");
  }

  return (
    <>
      <h1 className={styles.h1}>Gộp tài khoản học viên</h1>
      <p className={styles.muted}>Cách đăng nhập chuyển sang tài khoản đích. Đơn hàng và lịch sử giữ nguyên ở tài khoản gốc, quyền học đọc theo nhóm gộp.</p>
      {done && <p className={styles.ok} role="status">{done}</p>}
      <Picker title="Tài khoản nguồn" value={source} onPick={setSource} />
      <Picker title="Tài khoản đích" value={target} onPick={setTarget} />
      <section className={styles.card}>
        <Field label="Lý do *"><textarea className={styles.input} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {problem && !preview && <p className={styles.error} role="alert">{problem}</p>}
        <div className={styles.actions}><button className={styles.btnMain} disabled={!source || !target || !reason.trim() || busy} onClick={() => void call(true)}>Xem trước</button></div>
      </section>
      <ActionDialog open={preview !== null} title={`Gộp ${source?.displayName ?? ""} vào ${target?.displayName ?? ""}?`} confirmLabel="Gộp tài khoản" danger busy={busy} problem={problem} onClose={() => setPreview(null)} onConfirm={() => void call(false)}>
        <p>Cách đăng nhập chuyển sang: {preview?.identities.map((i) => `${KIND_LABEL[i.kind] ?? i.kind} ${i.value}`).join(", ") || "không có"}</p>
        <p>Khóa đang có: {preview?.activeEnrollments} · Đơn hàng: {preview?.orders}</p>
        <p className={styles.notice}>Việc này không hoàn tác được từ giao diện.</p>
      </ActionDialog>
    </>
  );
}
