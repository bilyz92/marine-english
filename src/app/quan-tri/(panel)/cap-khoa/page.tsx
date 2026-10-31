"use client";

import { useState } from "react";
import { ActionDialog, adminApi, Field, LoadState, problemOf, useLoad } from "../admin-lib";
import { LearnerSearch, type Learner } from "../learner-search";
import styles from "../admin.module.css";

type Course = { id: string; titleVi: string; status: string };

export default function GrantsPage() {
  const { data, reload, ...state } = useLoad<{ courses: Course[] }>("/api/quan-tri/courses");
  const [learners, setLearners] = useState<Learner[]>([]);
  const [learner, setLearner] = useState<Learner | null>(null);
  const [courseId, setCourseId] = useState("");
  const [reason, setReason] = useState("");
  const [revoke, setRevoke] = useState<{ enrollmentId: string; title: string; learner: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const course = data?.courses.find((c) => c.id === courseId);

  async function grant() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/grants", { method: "POST", body: { userId: learner!.id, courseId, reason } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setDone(`Đã cấp “${course?.titleVi}” cho ${learner!.displayName}.`);
    setConfirming(false);
    setReason("");
    setLearners([]);
    setLearner(null);
  }

  async function doRevoke() {
    setBusy(true);
    const r = await adminApi("/api/quan-tri/grants", { method: "PATCH", body: { enrollmentId: revoke!.enrollmentId, reason } });
    setBusy(false);
    const issue = problemOf(r);
    if (issue) return setProblem(issue);
    setDone(`Đã thu hồi “${revoke!.title}” của ${revoke!.learner}.`);
    setRevoke(null);
    setReason("");
    setLearners([]);
  }

  return (
    <>
      <h1 className={styles.h1}>Cấp không thu tiền</h1>
      <p className={styles.muted}>Dùng cho học nội bộ, quà tặng, hỗ trợ. Việc này không đánh dấu đơn đã thanh toán. Khoản tiền khách đã chuyển thì dùng “Ghép với đơn” ở Sổ giao dịch.</p>
      {done && <p className={styles.ok} role="status">{done}</p>}
      <LoadState {...state} reload={reload} />
      <section className={styles.card}><LearnerSearch onResults={(list) => { setLearners(list); setLearner(null); }} /></section>
      {learners.map((l) => (
        <section key={l.id} className={styles.card}>
          <h2 className={styles.h2}>{l.displayName}</h2>
          {l.courses.map((c) => (
            <div key={c.enrollmentId} className={styles.item}>
              <span>{c.title}</span>
              {c.source === "order"
                ? <span className={styles.tag}>Đã mua</span>
                : <button className={styles.btn} onClick={() => { setProblem(null); setReason(""); setRevoke({ enrollmentId: c.enrollmentId, title: c.title, learner: l.displayName }); }}>Thu hồi</button>}
            </div>
          ))}
          <div className={styles.actions}><button className={styles.btn} onClick={() => setLearner(l)} aria-pressed={learner?.id === l.id}>{learner?.id === l.id ? "Đã chọn" : "Chọn học viên này"}</button></div>
        </section>
      ))}
      {learner && data && (
        <section className={styles.card}>
          <Field label="Khóa *">
            <select className={styles.input} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
              <option value="">Chọn khóa</option>
              {data.courses.map((c) => <option key={c.id} value={c.id}>{c.titleVi}</option>)}
            </select>
          </Field>
          <div className={styles.actions}><button className={styles.btnMain} disabled={!courseId} onClick={() => { setProblem(null); setConfirming(true); }}>Cấp khóa</button></div>
        </section>
      )}
      <ActionDialog open={confirming} title={`Cấp “${course?.titleVi ?? ""}” cho ${learner?.displayName ?? ""}?`} confirmLabel="Cấp khóa" busy={busy} problem={problem} onClose={() => setConfirming(false)} onConfirm={() => void grant()}>
        <Field label="Lý do *"><textarea className={styles.input} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ActionDialog>
      <ActionDialog open={revoke !== null} title={`Thu hồi “${revoke?.title ?? ""}” của ${revoke?.learner ?? ""}?`} confirmLabel="Thu hồi" danger busy={busy} problem={problem} onClose={() => setRevoke(null)} onConfirm={() => void doRevoke()}>
        <Field label="Lý do *"><textarea className={styles.input} required value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </ActionDialog>
    </>
  );
}
