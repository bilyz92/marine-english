"use client";

import { useState } from "react";
import { adminApi, adminForm, fmtTime, LoadState, messageFor, useLoad } from "../../admin-lib";
import styles from "../../admin.module.css";

// Ghi âm của một bài: nghe lại, tải thêm, gỡ. Ghi âm đi theo bài khi sửa nội dung; bài dùng chung ở khóa khác cũng có.

type Audio = { id: string; mime: string; bytes: number; createdAt: string };
const MAX_BYTES = 4 * 1024 * 1024;
const size = (b: number) => (b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1_048_576).toFixed(1)} MB`);

export function LessonAudio({ slug, externalId, canEdit }: { slug: string; externalId: string; canEdit: boolean }) {
  const base = `/api/quan-tri/content/courses/${slug}/lessons/${encodeURIComponent(externalId)}/audio`;
  const { data, reload, ...state } = useLoad<{ audio: Audio[] }>(base);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setProblem("Chọn tệp ghi âm (mp3, m4a hoặc ogg).");
    if (file.size > MAX_BYTES) return setProblem("Tệp ghi âm cần nhỏ hơn 4 MB. Xuất lại mp3 128 kbps hoặc cắt ngắn hơn.");
    setBusy(true);
    setProblem(null);
    setDone(null);
    const form = new FormData();
    form.set("audio", file, file.name);
    const r = await adminForm(base, form);
    setBusy(false);
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setFile(null);
    (event.target as HTMLFormElement).reset();
    setDone("Đã tải lên. Học viên nghe được ở lần mở bài sau; máy đã tải khóa sẽ thấy nút Cập nhật.");
    await reload();
  }

  async function remove(id: string) {
    setProblem(null);
    setDone(null);
    const r = await adminApi(`${base}?asset=${id}`, { method: "DELETE", body: {} });
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setDone("Đã gỡ ghi âm khỏi bài.");
    await reload();
  }

  return (
    <div className={styles.form} style={{ flexBasis: "100%" }}>
      <LoadState {...state} reload={reload} />
      {data && data.audio.length === 0 && <p className={styles.muted}>Bài chưa có ghi âm.</p>}
      {data?.audio.map((a, i) => (
        <div key={a.id} className={styles.actions} style={{ alignItems: "center" }}>
          <audio controls preload="none" src={`/api/quan-tri/audio/${a.id}`} aria-label={`Ghi âm ${i + 1} của bài ${externalId}`} />
          <span className={styles.muted}>{size(a.bytes)} · {fmtTime(a.createdAt)}</span>
          {canEdit && <button type="button" className={styles.btn} onClick={() => void remove(a.id)}>Gỡ</button>}
        </div>
      ))}
      {canEdit && (
        <form className={styles.actions} onSubmit={(e) => void upload(e)}>
          <label>
            <span className={styles.muted}>Tệp ghi âm (mp3, m4a, ogg, dưới 4 MB) </span>
            <input type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg,.mp3,.m4a,.ogg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className={styles.btnMain} disabled={busy || !file}>{busy ? "Đang tải…" : "Tải lên"}</button>
        </form>
      )}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {done && <p className={styles.ok} role="status">{done}</p>}
    </div>
  );
}
