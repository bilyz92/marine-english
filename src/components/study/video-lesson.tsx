"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "@/app/hoc/learn.module.css";
import type { LessonContent } from "@/components/lesson-body";
import { SpeakButton } from "@/components/speak";

// Bài video (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 4), dùng chung cho app học và trang học thử.
// Có tệp thì phát tệp (đã tải về máy thì xem được khi mất mạng); không có tệp mà có mã YouTube thì nhúng youtube-nocookie khi có mạng.

type Text = { en?: string; vi?: string };
export type VideoContent = LessonContent & { video?: { youtube_id?: string } };

function Bilingual({ text, speak }: { text?: Text; speak?: boolean }) {
  return (
    <>
      {text?.en && <p className={styles.en}>{text.en}</p>}
      {text?.vi && <p className={styles.vi}>{text.vi}</p>}
      {speak && <SpeakButton text={text?.en} />}
    </>
  );
}

const hasText = (t?: Text) => !!(t?.en || t?.vi);
const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

type Props = {
  externalId: string;
  content: VideoContent;
  /** `src`: đường phát tệp video (blob: đã tải, hoặc API có kiểm quyền); null = bài không có tệp. `download`: khối tải về máy. */
  video: { src: string | null; download?: React.ReactNode };
  children?: React.ReactNode;
};

export function VideoLesson({ externalId, content, video, children }: Props) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const youtubeId = content.video?.youtube_id;
  const vocabulary = (content.vocabulary ?? []).map((v) => v.text ?? { en: v.en, vi: v.vi }).filter(hasText);
  let player: React.ReactNode;
  if (video.src) {
    player = (
      <>
        <video key={video.src} className={styles.video} controls playsInline preload="metadata" src={video.src} onError={() => setFailedSrc(video.src)} />
        {failedSrc === video.src && <p className={styles.muted} role="alert">Chưa xem được video: video chưa tải về máy và máy đang mất mạng.</p>}
      </>
    );
  } else if (youtubeId) {
    player = online ? (
      <iframe
        className={styles.video}
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`}
        title={content.question?.text?.en ?? "Video"}
        allow="encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    ) : <p className={styles.muted} role="status">Video YouTube cần có mạng để xem. Khi có mạng, mở lại bài này.</p>;
  } else {
    player = <p className={styles.muted}>Bài này chưa có video.</p>;
  }
  return (
    <>
      <div className={styles.card}>
        <p className={styles.muted}>Bài {externalId} · Video</p>
        <Bilingual text={content.question?.text} />
        {player}
        {video.download}
        {children}
      </div>
      {!!content.key_points?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Ý chính</h2>
          {content.key_points.map((k) => <div key={k.id} className={styles.item}><Bilingual text={k.text} speak /></div>)}
        </div>
      )}
      {!!vocabulary.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Từ vựng</h2>
          {vocabulary.map((v, i) => <div key={i} className={styles.item}><Bilingual text={v} speak /></div>)}
        </div>
      )}
    </>
  );
}
