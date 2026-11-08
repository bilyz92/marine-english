"use client";

import { useState } from "react";
import { adminUpload, Field, messageFor } from "../../admin-lib";
import styles from "../../admin.module.css";

// Khung bài giảng Excel (docs/superpowers/plans/2026-11-08-course-modules.md, Task 8): tải khung về, điền, tải lên, xem trước rồi thêm bài.

const MAX_BYTES = 2 * 1024 * 1024;
type Preview = { lessons: number; newModules: string[]; newTopics: string[]; errors: { row: number; message: string }[]; currentVersionId: string | null };

type Props = { slug: string; currentVersionId: string | null; live: boolean; canEdit: boolean; onDone: (message: string) => Promise<void> };

export function ExcelUpload({ slug, currentVersionId, live, canEdit, onDone }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Thêm xong thì dựng lại ô chọn tệp cho trống (trình duyệt giữ tên tệp cũ trong ô).
  const [round, setRound] = useState(0);

  function choose(next: File | null) {
    setFile(next);
    setPreview(null);
    setConfirmLive(false);
    setProblem(next && next.size > MAX_BYTES ? "Tệp lớn hơn 2 MB." : null);
  }

  async function send(confirm: boolean) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    const query = new URLSearchParams({
      ...(confirm ? { confirm: "1", expectedVersionId: preview?.currentVersionId ?? currentVersionId ?? "" } : {}),
      ...(confirm && confirmLive ? { confirmLive: "1" } : {}),
    });
    const r = await adminUpload<Preview>(`/api/quan-tri/content/courses/${slug}/excel?${query}`, file);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 413) return setProblem("Tệp lớn hơn 2 MB.");
      if (r.data.error === "stale") {
        setPreview(null);
        return setProblem("Khóa vừa được sửa ở chỗ khác. Bấm Xem trước lại.");
      }
      return setProblem(messageFor(r.data.error));
    }
    if (!confirm || r.data.errors.length) return setPreview(r.data);
    setFile(null);
    setPreview(null);
    setRound(round + 1);
    await onDone(`Đã thêm ${r.data.lessons} bài từ file Excel.`);
  }

  return (
    <section className={styles.card} aria-label="Khung bài giảng Excel">
      <h2 className={styles.h2}>Khung bài giảng (Excel)</h2>
      <p className={styles.muted}>Tải khung về, điền mỗi dòng một bài (Hỏi–đáp hoặc Tự luận), rồi tải lên. Bài mới được thêm vào cuối khóa.</p>
      <div className={styles.actions}>
        <a className={styles.btnLink} href="/api/quan-tri/content/template" download>Tải khung bài giảng (Excel)</a>
      </div>
      {canEdit && (
        <>
          <Field label="Tải lên file Excel">
            <input key={round} className={styles.input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          </Field>
          <div className={styles.actions}>
            <button className={styles.btn} disabled={!file || busy || file.size > MAX_BYTES} onClick={() => void send(false)}>{busy && !preview ? "Đang đọc tệp…" : "Xem trước"}</button>
          </div>
          {preview && preview.errors.length > 0 && (
            <div className={styles.error} role="alert">
              <p>Tệp còn {preview.errors.length} lỗi, chưa thêm bài nào. Sửa trong Excel rồi tải lên lại:</p>
              <ul>{preview.errors.map((e, i) => <li key={i}>Dòng {e.row}: {e.message}</li>)}</ul>
            </div>
          )}
          {preview && preview.errors.length === 0 && (
            <div className={styles.form}>
              <p>
                {preview.lessons} bài sẽ được thêm vào cuối khóa.
                {preview.newModules.length > 0 && ` Module mới: ${preview.newModules.join(", ")}.`}
                {preview.newTopics.length > 0 && ` Chủ đề mới: ${preview.newTopics.join(", ")}.`}
              </p>
              {live && (
                <label className={styles.notice}>
                  <input type="checkbox" checked={confirmLive} onChange={(e) => setConfirmLive(e.target.checked)} /> Khóa đang bán: tôi hiểu học viên sẽ thấy bài mới.
                </label>
              )}
              <div className={styles.actions}>
                <button className={styles.btnMain} disabled={busy || (live && !confirmLive)} onClick={() => void send(true)}>{busy ? "Đang thêm…" : `Thêm ${preview.lessons} bài`}</button>
              </div>
            </div>
          )}
          {problem && <p className={styles.error} role="alert">{problem}</p>}
        </>
      )}
    </section>
  );
}
