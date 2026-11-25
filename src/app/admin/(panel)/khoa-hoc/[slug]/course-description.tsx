"use client";

import { useState } from "react";
import { adminApi, Field, messageFor } from "../../admin-lib";
import styles from "../../admin.module.css";

// Ô "Giới thiệu khóa học" (chủ 26/11/2026): hiện trên trang khóa công khai, ngay dưới tên khóa. Chỉ chủ sửa (quyền prices.edit, như giá).
const MAX = 8000;

type Props = { courseId: string; description: string | null; canEdit: boolean; onChanged: (message: string) => Promise<void> };

export function CourseDescriptionEditor({ courseId, description, canEdit, onChanged }: Props) {
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const value = text ?? description ?? "";
  const dirty = text !== null && text.trim() !== (description ?? "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const r = await adminApi(`/api/quan-tri/courses/${courseId}`, { method: "PATCH", body: { description: value } });
    // Không xóa bản đang gõ ở đây: tải lại xong, key đổi theo mô tả mới nên ô soạn dựng lại từ dữ liệu đã lưu.
    if (r.ok) await onChanged(value.trim() ? "Đã lưu giới thiệu khóa học." : "Đã xóa giới thiệu khóa học.");
    else setProblem(messageFor((r.data as { error?: string }).error));
    setBusy(false);
  }

  return (
    <form className={styles.card} onSubmit={(e) => void save(e)} aria-label="Giới thiệu khóa học">
      <h2 className={styles.h2}>Giới thiệu khóa học</h2>
      <p className={styles.muted}>Hiện trên trang khóa công khai, dưới tên khóa. Dòng trống tách đoạn; dòng bắt đầu bằng “## ” là tiêu đề nhỏ; dòng bắt đầu bằng “* ” là gạch đầu dòng.</p>
      <Field label={`Nội dung (${value.length}/${MAX} ký tự)`}>
        <textarea className={styles.input} rows={14} maxLength={MAX} value={value} disabled={!canEdit || busy} onChange={(e) => setText(e.target.value)} />
      </Field>
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {canEdit && (
        <div className={styles.actions}>
          <button className={styles.btnMain} type="submit" disabled={busy || !dirty}>{busy ? "Đang lưu…" : "Lưu giới thiệu"}</button>
        </div>
      )}
    </form>
  );
}
