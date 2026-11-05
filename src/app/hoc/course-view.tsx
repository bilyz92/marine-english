"use client";

import { useEffect, useState } from "react";
import {
  downloadCourse, downloadState, loadManifest,
  type DownloadState, type Identity, type LicenseStatus, type Manifest,
} from "@/lib/offline/engine";
import { canOpenLesson } from "@/lib/offline/access";
import { downloadPanel } from "@/lib/offline/downloads";
import { nowSeconds } from "@/lib/offline/engine";
import { groupByTopic } from "@/lib/offline/topics";
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
        <p><a className={styles.barLink} href="/tai-khoan/thanh-toan">Xem đơn hàng và lý do</a></p>
      </div>
    );
  }

  const done = manifest.lessons.filter((l) => l.status === "completed").length;
  // Chưa biết trạng thái trên máy thì chưa hiện nút, tránh nháy nút tải với khóa đã tải đủ.
  const panel = saved ? downloadPanel({ provisional: manifest.provisional === true, complete: saved.complete, everDownloaded: saved.everDownloaded }) : "hidden";

  const groups = groupByTopic(manifest.topics, manifest.lessons);

  /** Một dòng bài: trong nhóm chủ đề thì có cột mã bài (A022), danh sách phẳng thì số thứ tự như trước. */
  function row(l: Manifest["lessons"][number], coded: boolean) {
    const blocked = !canOpenLesson({
      isFreeTrial: l.isFreeTrial, courseId: manifest!.courseId, versionId: manifest!.versionId, license, identity, now: nowSeconds(),
    });
    return (
      <button className={coded ? styles.lessonRow : styles.row} disabled={blocked} onClick={() => go({ khoa: slug, bai: l.position })}>
        {coded && <span className={styles.lessonId}>{l.externalId}</span>}
        <span className={styles.rowTitle}>{coded ? l.title : `${l.position}. ${l.title}`}</span>
        {l.status === "completed" ? <span className={styles.tagDone}>Đã xong</span>
          : l.status === "in_progress" ? <span className={styles.tagDoing}>Đang học</span>
          : l.isFreeTrial ? <span className={styles.tagTrial}>Học thử</span> : null}
      </button>
    );
  }

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
      <div className={styles.head}>
        <h1 className={styles.h1}>{manifest.titleVi}</h1>
        <p className={styles.muted}>Đã học xong {done}/{manifest.lessons.length} bài</p>
        <div className={styles.progress} aria-hidden="true"><div className={styles.progressFill} style={{ width: `${manifest.lessons.length ? (done / manifest.lessons.length) * 100 : 0}%` }} /></div>
      </div>
      {panel === "awaiting_payment" && (
        <div className={styles.plate}>
          <h2 className={styles.h2}>Học khi không có mạng</h2>
          <p className={styles.muted}>Bạn đang học online. Tải khóa về máy được sau khi đơn được xác nhận đã thanh toán.</p>
        </div>
      )}
      {(panel === "download" || panel === "update") && saved && (
        <div className={styles.plate}>
          <h2 className={styles.h2}>{panel === "update" ? "Có bài mới cập nhật" : "Học khi không có mạng"}</h2>
          <p className={styles.muted}>
            {panel === "update" ? "Cần cập nhật" : "Cần tải"} {saved.missingLessons} bài
            {saved.missingAssets > 0 ? ` và ${saved.missingAssets} tệp âm thanh (${megabytes(saved.assetBytes)})` : ""}. Nên tải khi có Wi-Fi.
          </p>
          {progress ? (
            <div className={styles.progress} role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <div className={styles.progressFill} style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
            </div>
          ) : (
            <p><button className={styles.primary} onClick={download}>{panel === "update" ? "Cập nhật" : "Tải khóa về máy"}</button></p>
          )}
          {error && <p className={styles.bannerDanger}>{error}</p>}
        </div>
      )}
      {groups ? (
        <section className={styles.card} aria-label="Danh sách bài">
          <h2 className={styles.h2}>Danh sách bài</h2>
          {groups.map((g) => (
            <details key={g.id ?? "khac"} className={styles.topic} open={g.open}>
              <summary>
                {g.id && <span className={styles.topicCode}>{g.id}</span>}
                <span className={styles.topicTitle}>{g.titleVi}<span className={styles.topicCount}>{g.done}/{g.lessons.length} bài</span></span>
              </summary>
              <ul className={styles.lessonRows}>{g.lessons.map((l) => <li key={l.lessonVersionId}>{row(l, true)}</li>)}</ul>
            </details>
          ))}
        </section>
      ) : (
        <ul className={styles.list}>{manifest.lessons.map((l) => <li key={l.lessonVersionId}>{row(l, false)}</li>)}</ul>
      )}
    </>
  );
}
