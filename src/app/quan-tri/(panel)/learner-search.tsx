"use client";

import { useState } from "react";
import { adminApi, Field, messageFor } from "./admin-lib";
import styles from "./admin.module.css";

export type Learner = {
  id: string; displayName: string; rank: string | null; status: string; mergedIntoId: string | null;
  identities: { kind: string; value: string }[];
  courses: { enrollmentId: string; courseId: string; title: string; source: string }[];
  passwordLogin: { phone: string; verified: boolean; released: boolean; mustChange: boolean } | null;
};

export const KIND_LABEL: Record<string, string> = { email: "Email", phone: "Điện thoại", google: "Google" };

/** Ô tìm học viên dùng chung cho các màn quản trị. */
export function LearnerSearch({ label = "Tìm học viên", onResults }: { label?: string; onResults: (learners: Learner[]) => void }) {
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const r = await adminApi<{ learners: Learner[] }>(`/api/quan-tri/learners?q=${encodeURIComponent(q)}`);
    setBusy(false);
    if (!r.ok) {
      onResults([]);
      return setNote(messageFor(r.data.error));
    }
    onResults(r.data.learners);
    setNote(r.data.learners.length === 0 ? "Không tìm thấy. Nhập email, số điện thoại, mã đơn hoặc tên (ít nhất 2 ký tự)." : null);
  }

  return (
    <form className={styles.form} onSubmit={search}>
      <Field label={label}><input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, số điện thoại, mã đơn hoặc tên" /></Field>
      <div className={styles.actions}><button className={styles.btnMain} disabled={busy}>{busy ? "Đang tìm…" : "Tìm"}</button></div>
      {note && <p className={styles.muted} role="status">{note}</p>}
    </form>
  );
}
