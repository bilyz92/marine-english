"use client";

import { useEffect, useRef, useState } from "react";
import {
  assetUrl, loadLesson, loadManifest, recordEvent,
  type Identity, type LicenseStatus, type Manifest, type ManifestLesson,
} from "@/lib/offline/engine";
import { canOpenLesson } from "@/lib/offline/access";
import { licenseStatus, nowSeconds } from "@/lib/offline/engine";
import { LessonBody, type LessonContent } from "@/components/lesson-body";
import { LessonStudy } from "@/components/study/lesson-study";
import { EssayLesson } from "@/components/study/essay-lesson";
import { groupActivities, hasLevels, type StudyLesson } from "@/lib/study/levels";
import { go } from "./learn-app";
import styles from "./learn.module.css";

const ACTIVITY_LABEL: Record<string, string> = {
  listen: "Nghe",
  read: "Đọc hiểu",
  study: "Học ý chính",
  spoken_recall: "Tự nói lại không nhìn đáp án",
  record_audio: "Tập nói",
  self_review: "Tự đánh giá",
};

type Props = {
  identity: Identity;
  slug: string;
  position: number;
  /** Trạng thái giấy phép hiện tại của app (tính lại mỗi phút, khi mở lại app và sau đồng bộ). */
  license: LicenseStatus | null;
  onEvent: () => void;
  onFinish: () => void;
};

export function LessonView({ identity, slug, position, license: liveLicense, onEvent, onFinish }: Props) {
  const [loaded, setLoaded] = useState<
    { manifest: Manifest; lesson: ManifestLesson; content: LessonContent | null; license: LicenseStatus } | "missing" | null
  >(null);
  const [doneActivities, setDoneActivities] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState(false);
  const [audio, setAudio] = useState<string[]>([]);
  const opened = useRef<string | null>(null);
  // Giấy phép đổi giữa chừng (hết hạn, đồng bộ xong có lại) thì đọc lại bài theo quyền mới; gia hạn thường không làm đổi khóa này.
  const licenseKey = liveLicense ? `${liveLicense.state}:${liveLicense.claims?.courses.map((c) => `${c.id}/${c.versionId}`).join(",")}` : null;

  useEffect(() => {
    let stale = false;
    void (async () => {
      const manifest = await loadManifest(identity, slug);
      if (stale) return;
      const lesson = manifest?.lessons.find((l) => l.position === position);
      if (!manifest || !lesson) return setLoaded("missing");
      // Xét quyền với giấy phép đọc mới ngay lúc mở bài (mốc thời gian được nâng trước).
      const license = await licenseStatus(identity);
      const allowed = canOpenLesson({
        isFreeTrial: lesson.isFreeTrial, courseId: manifest.courseId, versionId: manifest.versionId, license, identity, now: nowSeconds(),
      });
      const content = allowed ? ((await loadLesson(identity, lesson)) as LessonContent | null) : null;
      if (stale) return;
      setLoaded({ manifest, lesson, content, license });
      setDoneActivities(new Set(lesson.completedActivities));
      setCompleted(lesson.status === "completed");
      const audioUrls = await Promise.all(manifest.assets.filter((a) => a.lessonVersionId === lesson.lessonVersionId && a.role === "audio").map((a) => assetUrl(identity, a)));
      if (stale) return;
      setAudio(audioUrls);
      if (allowed && content && opened.current !== lesson.lessonVersionId) {
        opened.current = lesson.lessonVersionId;
        await recordEvent(identity, "lesson_opened", lesson.lessonVersionId);
        onEvent();
      }
    })();
    return () => {
      stale = true;
    };
    // onEvent chỉ cập nhật bộ đếm, không cần chạy lại khi nó đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, slug, position, licenseKey]);

  if (!loaded) return <p className={styles.muted}>Đang mở bài…</p>;
  if (loaded === "missing") return <div className={styles.card}><p className={styles.muted}>Không tìm thấy bài này trên máy. Kết nối mạng để tải.</p></div>;

  const { manifest, lesson, content } = loaded;
  // Xét lại mỗi lần vẽ theo giấy phép mới nhất, không theo bản đọc lúc mở bài.
  const license = liveLicense ?? loaded.license;
  if (!canOpenLesson({
    isFreeTrial: lesson.isFreeTrial, courseId: manifest.courseId, versionId: manifest.versionId, license, identity, now: nowSeconds(),
  })) {
    const why = license?.state === "unverifiable"
      ? "Trình duyệt này chưa kiểm được giấy phép học offline. Cập nhật trình duyệt hoặc học khi có mạng."
      : "Bài này chưa mở được trên máy: kết nối mạng để đồng bộ giấy phép học rồi học tiếp.";
    return <div className={styles.card}><p className={styles.muted}>{why}</p></div>;
  }
  if (!content) {
    return <div className={styles.card}><p className={styles.muted}>Bài này chưa được tải về máy. Khi có mạng, mở lại bài hoặc bấm “Tải khóa về máy” ở trang khóa.</p></div>;
  }

  async function completeActivities(ids: string[]) {
    const fresh = ids.filter((id) => !doneActivities.has(id));
    if (!fresh.length) return;
    setDoneActivities(new Set([...doneActivities, ...fresh]));
    for (const id of fresh) await recordEvent(identity, "activity_completed", lesson.lessonVersionId, { activityId: id });
    onEvent();
  }

  async function finish() {
    setCompleted(true);
    await recordEvent(identity, "lesson_completed", lesson.lessonVersionId);
    onFinish();
  }

  const next = manifest.lessons.find((l) => l.position === position + 1);
  return (
    <>
      <h1 className={styles.srOnly}>Bài {position}: {lesson.title}</h1>
      <div className={styles.actions}>
        <button className={styles.secondary} onClick={() => go({ khoa: slug })}>← Danh sách bài</button>
      </div>
      {(content as { lesson_type?: string }).lesson_type === "essay" ? (
        <EssayLesson externalId={lesson.externalId} content={content} who={identity.userId}>
          {audio.map((src) => <audio key={src} className={styles.audio} controls src={src} />)}
        </EssayLesson>
      ) : hasLevels(content as StudyLesson) ? (
        <LessonStudy externalId={lesson.externalId} lesson={content as StudyLesson} who={identity.userId}>
          {audio.map((src) => <audio key={src} className={styles.audio} controls src={src} />)}
        </LessonStudy>
      ) : (
        <LessonBody externalId={lesson.externalId} content={content}>
          {audio.map((src) => <audio key={src} className={styles.audio} controls src={src} />)}
          {audio.length === 0 && <p className={styles.muted}>Bài này chưa có âm thanh.</p>}
        </LessonBody>
      )}
      {!!content.activities?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Hoạt động</h2>
          {groupActivities(content.activities).map((a) => {
            const done = a.ids.every((id) => doneActivities.has(id));
            return (
              <label key={a.type} className={styles.check}>
                <input type="checkbox" checked={done} disabled={done} onChange={() => void completeActivities(a.ids)} />
                {ACTIVITY_LABEL[a.type] ?? a.type}
              </label>
            );
          })}
        </div>
      )}
      <div className={styles.actions}>
        <button className={styles.secondary} disabled={completed} onClick={() => void finish()}>{completed ? "Đã học xong bài này" : "Đánh dấu đã học xong"}</button>
        {next && <button className={styles.secondary} onClick={() => go({ khoa: slug, bai: next.position })}>Bài tiếp →</button>}
      </div>
    </>
  );
}
