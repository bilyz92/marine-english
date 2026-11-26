"use client";

import { useState } from "react";
import { adminApi, Field, messageFor } from "../../admin-lib";
import styles from "../../admin.module.css";

// Ô "Đường dẫn công khai" (SEO, chủ 26/11/2026): trang khóa là /khoa-hoc/<đường dẫn>. Chỉ chủ sửa (quyền prices.edit, như giá).
// Gõ tự do (có dấu cũng được), máy chủ chuẩn hóa; đường dẫn cũ vẫn chuyển hướng về khóa.

type Props = { courseId: string; urlSlug: string; canEdit: boolean; onChanged: (message: string) => Promise<void> };

export function CourseUrlEditor({ courseId, urlSlug, canEdit, onChanged }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = text ?? urlSlug;
  const dirty = text !== null && text.trim() !== urlSlug;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const r = await adminApi(`/api/quan-tri/courses/${courseId}`, { method: "PATCH", body: { urlSlug: value } });
    if (r.ok) await onChanged("Đã đổi đường dẫn. Link cũ vẫn tự chuyển sang đường dẫn mới.");
    else setProblem(messageFor((r.data as { error?: string }).error));
    setBusy(false);
  }

  return (
    <form className={styles.card} onSubmit={(e) => void save(e)} aria-label="Đường dẫn công khai">
      <h2 className={styles.h2}>Đường dẫn công khai</h2>
      <p className={styles.muted}>
        Trang khóa: <a href={`/khoa-hoc/${urlSlug}`} target="_blank" rel="noreferrer">/khoa-hoc/{urlSlug}</a>. Chỉ chữ thường không dấu, số và
        dấu gạch ngang; gõ có dấu thì máy tự bỏ dấu. Đổi xong, link cũ đã chia sẻ vẫn tự chuyển sang đường dẫn mới.
      </p>
      <Field label="Đường dẫn">
        <input className={styles.input} value={value} maxLength={200} disabled={!canEdit || busy} onChange={(e) => setText(e.target.value)} />
      </Field>
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.btnMain} type="submit" disabled={busy || !dirty}>{busy ? "Đang lưu…" : "Lưu đường dẫn"}</button>
        </div>
      )}
    </form>
  );
}
