"use client";

import { useEffect, useState } from "react";
import {
  downloadCourse, downloadState, loadManifest,
  type DownloadState, type Identity, type LicenseStatus, type Manifest,
} from "@/lib/offline/engine";
import { go } from "./learn-app";
import styles from "./learn.module.css";

const megabytes = (bytes: number) => `${Math.max(bytes / 1_048_576, 0.1).toFixed(1)} MB`;

const DOWNLOAD_ERROR = {
  failed: "Tải chưa xong do mất mạng. Phần đã tải được giữ lại; bấm tải tiếp khi có mạng.",
  hash_mismatch: "Có tệp tải về bị lỗi và chưa được lưu. Bấm tải tiếp để tải lại tệp đó.",
} as const;

export function CourseView({ identity, slug, license }: { identity: Identity; slug: string; license: LicenseStatus | null }) {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined);
  const [saved, setSaved] = useState<DownloadState | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadManifest(identity, slug).then(async (m) => {
      setManifest(m);
      if (m) setSaved(await downloadState(identity, m));
    });
  }, [identity, slug]);

  if (manifest === undefined) return <p className={styles.muted}>Đang tải khóa học…</p>;
  if (!manifest) {
    return (
      <div className={styles.card}>
        <h1 className={styles.h1}>Không mở được khóa này</h1>
        <p className={styles.muted}>Khóa chưa có trên máy, hoặc anh/chị không còn quyền học khóa này. Kết nối mạng để kiểm tra lại.</p>
      </div>
    );
  }

  const locked = license?.state === "locked";
  const done = manifest.lessons.filter((l) => l.status === "completed").length;

  async function download() {
    if (!manifest) return;
    setError(null);
    const result = await downloadCourse(identity, manifest, (d, total) => setProgress({ done: d, total }));
    setProgress(null);
    if (result !== "done") setError(DOWNLOAD_ERROR[result]);
    setSaved(await downloadState(identity, manifest));
  }

  return (
    <>
      <div className={styles.card}>
        <h1 className={styles.h1}>{manifest.titleVi}</h1>
        <p className={styles.muted}>Đã học xong {done}/{manifest.lessons.length} bài</p>
      </div>
      <div className={styles.card}>
        <h2 className={styles.h2}>Học khi không có mạng</h2>
        {saved?.complete ? (
          <p className={styles.muted}>Đã tải xong toàn bộ khóa về máy. Bài học được cả khi tàu mất mạng.</p>
        ) : (
          <>
            <p className={styles.muted}>
              Cần tải {saved?.missingLessons ?? manifest.lessons.length} bài
              {saved && saved.missingAssets > 0 ? ` và ${saved.missingAssets} tệp âm thanh (${megabytes(saved.assetBytes)})` : ""}. Nên tải khi có Wi-Fi.
            </p>
            {progress ? (
              <div className={styles.progress} role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
                <div className={styles.progressFill} style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
              </div>
            ) : (
              <p><button className={styles.primary} onClick={download}>Tải khóa về máy</button></p>
            )}
          </>
        )}
        {error && <p className={styles.bannerDanger}>{error}</p>}
      </div>
      <ul className={styles.list}>
        {manifest.lessons.map((l) => {
          const blocked = locked && !l.isFreeTrial;
          return (
            <li key={l.lessonVersionId}>
              <button className={styles.row} disabled={blocked} onClick={() => go({ khoa: slug, bai: l.position })}>
                <span className={styles.rowTitle}>{l.position}. {l.title}</span>
                {l.status === "completed" ? <span className={styles.tagDone}>Đã xong</span>
                  : l.status === "in_progress" ? <span className={styles.tagDoing}>Đang học</span>
                  : l.isFreeTrial ? <span className={styles.tagTrial}>Học thử</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
