"use client";

import { useState } from "react";
import { MAX_VIDEO_BYTES } from "@/modules/content/video-format";
import { adminApi, csrf, fmtTime, LoadState, messageFor, useLoad } from "../../admin-lib";
import styles from "../../admin.module.css";

// Tệp video của một bài video (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 5): xem lại, tải lên (thay tệp cũ), gỡ.
// Tải lên bằng XMLHttpRequest với thân là chính tệp, để có phần trăm tiến độ (fetch chưa báo tiến độ gửi lên).

type Video = { id: string; mime: string; bytes: number; createdAt: string };
const size = (b: number) => `${Math.max(b / 1_048_576, 0.1).toFixed(1)} MB`;

function send(url: string, file: File, onProgress: (pct: number) => void): Promise<{ status: number; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(csrf())) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let error: string | undefined;
      try {
        error = (JSON.parse(xhr.responseText) as { error?: string }).error;
      } catch {
        // Thân không phải JSON (ví dụ trang lỗi của nginx).
      }
      resolve({ status: xhr.status, error });
    };
    xhr.onerror = () => resolve({ status: 0 });
    xhr.send(file);
  });
}

export function LessonVideo({ slug, externalId, canEdit, onChanged }: { slug: string; externalId: string; canEdit: boolean; onChanged: () => void }) {
  const base = `/api/quan-tri/content/courses/${slug}/lessons/${encodeURIComponent(externalId)}/video`;
  const { data, reload, ...state } = useLoad<{ video: Video[] }>(base);
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setProblem("Chọn tệp video (mp4 hoặc webm).");
    if (file.size > MAX_VIDEO_BYTES) return setProblem("Tệp lớn hơn 300 MB. Xuất lại video ở 720p hoặc cắt ngắn hơn.");
    setProblem(null);
    setDone(null);
    setPercent(0);
    const r = await send(base, file, setPercent);
    setPercent(null);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- phiên hết hạn: tải lại toàn trang để bỏ trạng thái cũ.
    if (r.status === 401) return window.location.assign(`/admin/dang-nhap`);
    if (r.status === 413) return setProblem("Tệp lớn hơn 300 MB.");
    if (r.status === 0) return setProblem("Không kết nối được, kiểm tra mạng.");
    if (r.status !== 200) return setProblem(messageFor(r.error));
    setFile(null);
    (event.target as HTMLFormElement).reset();
    setDone("Đã tải lên. Xem lại video bên dưới để chắc chắn phát được (nên xuất MP4 H.264).");
    await reload();
    onChanged();
  }

  async function remove(id: string) {
    setProblem(null);
    setDone(null);
    const r = await adminApi(`${base}?asset=${id}`, { method: "DELETE", body: {} });
    if (!r.ok) return setProblem(messageFor(r.data.error));
    setDone("Đã gỡ video khỏi bài.");
    await reload();
    onChanged();
  }

  const busy = percent !== null;
  return (
    <div className={styles.form} style={{ flexBasis: "100%", minWidth: 0, maxWidth: "100%" }}>
      <LoadState {...state} reload={reload} />
      {data && data.video.length === 0 && <p className={styles.muted}>Bài chưa có tệp video.</p>}
      {data?.video.map((v) => (
        <div key={v.id} className={styles.form}>
          <video controls preload="none" style={{ display: "block", width: "100%", maxWidth: 640, minWidth: 0 }} src={`/api/quan-tri/audio/${v.id}`} aria-label={`Video của bài ${externalId}`} />
          <div className={styles.actions} style={{ alignItems: "center" }}>
            <span className={styles.muted}>{size(v.bytes)} · {fmtTime(v.createdAt)}</span>
            {canEdit && <button type="button" className={styles.btn} disabled={busy} onClick={() => void remove(v.id)}>Gỡ video</button>}
          </div>
        </div>
      ))}
      {canEdit && (
        <form className={styles.actions} onSubmit={(e) => void upload(e)}>
          <label style={{ minWidth: 0, maxWidth: "100%" }}>
            <span className={styles.muted}>Tệp video (mp4 H.264 hoặc webm, tối đa 300 MB; tải tệp mới sẽ thay tệp cũ) </span>
            <input type="file" accept="video/mp4,video/webm,.mp4,.m4v,.webm" disabled={busy} style={{ maxWidth: "100%" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <button className={styles.btnMain} disabled={busy || !file}>{busy ? `Đang tải… ${percent}%` : "Tải video lên"}</button>
        </form>
      )}
      {busy && (
        <progress max={100} value={percent ?? 0} aria-label="Tiến độ tải video lên" style={{ width: "100%" }} />
      )}
      {problem && <p className={styles.error} role="alert">{problem}</p>}
      {done && <p className={styles.ok} role="status">{done}</p>}
    </div>
  );
}
