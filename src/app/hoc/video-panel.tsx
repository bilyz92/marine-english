"use client";

import { useEffect, useRef, useState } from "react";
import { deleteVideo, downloadVideo, videoBlob, videoState, type Identity, type Manifest, type VideoState } from "@/lib/offline/engine";
import type { ManifestAsset } from "@/lib/offline/downloads";
import { VideoLesson, type VideoContent } from "@/components/study/video-lesson";
import styles from "./learn.module.css";

// Bài video trong app học (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 4): phát từ máy nếu đã tải, không thì từ máy chủ
// (có kiểm quyền); tải riêng từng video, không tự tải cùng khóa. Component này là chủ duy nhất của URL blob: tạo và thu hồi tại đây.

const megabytes = (bytes: number) => `${Math.max(bytes / 1_048_576, 0.1).toFixed(1)} MB`;

const VIDEO_ERROR = {
  failed: "Tải video chưa xong do mất mạng. Phần đã tải được giữ lại; bấm tải tiếp khi có mạng.",
  hash_mismatch: "Video tải về bị lỗi và chưa được lưu. Bấm tải lại.",
  cancelled: "Video này đã đổi hoặc khóa không còn trên máy. Mở lại bài để tải bản mới.",
} as const;

type Props = { identity: Identity; manifest: Manifest; asset: ManifestAsset | null; externalId: string; content: VideoContent; children?: React.ReactNode };

export function VideoPanel({ identity, manifest, asset, externalId, content, children }: Props) {
  const [state, setState] = useState<VideoState | null>(null);
  // Chưa biết video đã tải chưa: phát tạm từ máy chủ, đổi sang URL blob ngay khi đọc xong kho trên máy.
  const [src, setSrc] = useState<string | null>(asset?.url ?? null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = useRef(false);
  // URL blob đang dùng (nếu có): thu hồi khi rời bài, đổi video, hoặc ngay khi xóa video khỏi máy.
  const blobUrl = useRef<string | null>(null);
  const releaseBlobUrl = () => {
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    blobUrl.current = null;
  };
  const assetId = asset?.assetId ?? null;
  // Nguồn phát chọn một lần khi mở bài: đã tải xong → URL blob (thu hồi khi đổi bài/nguồn hoặc rời trang), chưa → API có kiểm quyền.
  // Tải xong giữa chừng không đổi nguồn (đổi nguồn sẽ phát lại từ đầu); lần mở sau mới phát từ máy.
  useEffect(() => {
    if (!asset) return;
    let stale = false;
    void (async () => {
      const current = await videoState(identity, asset);
      const blob = current === "done" ? await videoBlob(identity, asset) : null;
      if (stale) return;
      setState(blob ? "done" : current === "done" ? "partial" : current);
      if (blob) blobUrl.current = URL.createObjectURL(blob);
      setSrc(blobUrl.current ?? asset.url);
    })();
    return () => {
      stale = true;
      releaseBlobUrl();
    };
    // asset đọc theo assetId: manifest đọc lại (đổi giấy phép) tạo đối tượng mới nhưng cùng video thì không chọn lại nguồn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, assetId]);

  async function download() {
    if (!asset || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const result = await downloadVideo(identity, asset, (done, total) => setProgress({ done, total }));
      if (result !== "done") setError(VIDEO_ERROR[result]);
      setState(await videoState(identity, asset));
    } catch {
      setError(VIDEO_ERROR.failed);
    } finally {
      setProgress(null);
      busy.current = false;
    }
  }

  async function remove() {
    if (!asset) return;
    try {
      await deleteVideo(identity, asset);
      setState("none");
      // Đang phát từ blob: các đoạn trên máy vừa bị xóa, chuyển về phát từ máy chủ.
      setSrc(asset.url);
      releaseBlobUrl();
    } catch {
      setError("Chưa xóa được video khỏi máy. Thử lại.");
    }
  }

  let block: React.ReactNode = null;
  if (asset && !manifest.provisional && state) {
    block = (
      <div className={styles.actions}>
        {progress ? (
          <div style={{ flex: 1 }}>
            <div className={styles.progress} role="progressbar" aria-label="Đang tải video" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <div className={styles.progressFill} style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
            </div>
            <p className={styles.muted}>Đang tải video: {megabytes(progress.done)} / {megabytes(progress.total)}</p>
          </div>
        ) : state === "done" ? (
          <>
            <p className={styles.muted}>Đã tải video về máy</p>
            <button type="button" className={styles.secondary} onClick={() => void remove()}>Xóa khỏi máy</button>
          </>
        ) : (
          <button type="button" className={styles.secondary} onClick={() => void download()}>
            {state === "partial" ? "Tải tiếp video" : "Tải video về máy"} ({megabytes(asset.bytes)})
          </button>
        )}
        {error && <p className={styles.muted} role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <VideoLesson externalId={externalId} content={content} video={{ src: asset ? src : null, download: block }}>
      {children}
    </VideoLesson>
  );
}
