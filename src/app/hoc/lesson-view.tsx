"use client";

import { useEffect, useRef, useState } from "react";
import {
  assetUrl, loadLesson, loadManifest, recordEvent,
  type Identity, type LicenseStatus, type Manifest, type ManifestLesson,
} from "@/lib/offline/engine";
import { go } from "./learn-app";
import styles from "./learn.module.css";

type Text = { en?: string; vi?: string };
type Activity = { id: string; order: number; type: string; requires_microphone?: boolean };
type LessonContent = {
  question?: { text?: Text };
  key_points?: { id: string; text?: Text }[];
  vocabulary?: { id: string; text?: Text }[];
  model_answer?: { text?: Text };
  follow_up_questions?: { id: string; prompt?: Text }[];
  recall_cards?: { id: string; front?: Text; back?: Text }[];
  activities?: Activity[];
};

const ACTIVITY_LABEL: Record<string, string> = {
  listen: "Nghe",
  read: "Đọc hiểu",
  study: "Học ý chính",
  spoken_recall: "Tự nói lại không nhìn đáp án",
  record_audio: "Tập nói",
  self_review: "Tự đánh giá",
};

function Bilingual({ text }: { text?: Text }) {
  return (
    <>
      {text?.en && <p className={styles.en}>{text.en}</p>}
      {text?.vi && <p className={styles.vi}>{text.vi}</p>}
    </>
  );
}

type Props = {
  identity: Identity;
  slug: string;
  position: number;
  license: LicenseStatus | null;
  onEvent: () => void;
  onFinish: () => void;
};

export function LessonView({ identity, slug, position, license, onEvent, onFinish }: Props) {
  const [loaded, setLoaded] = useState<{ manifest: Manifest; lesson: ManifestLesson; content: LessonContent | null } | "missing" | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [shownCards, setShownCards] = useState<Set<string>>(new Set());
  const [doneActivities, setDoneActivities] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState(false);
  const [audio, setAudio] = useState<string[]>([]);
  const opened = useRef<string | null>(null);

  useEffect(() => {
    void (async () => {
      const manifest = await loadManifest(identity, slug);
      const lesson = manifest?.lessons.find((l) => l.position === position);
      if (!manifest || !lesson) return setLoaded("missing");
      const content = (await loadLesson(identity, lesson)) as LessonContent | null;
      setLoaded({ manifest, lesson, content });
      setDoneActivities(new Set(lesson.completedActivities));
      setCompleted(lesson.status === "completed");
      setAudio(await Promise.all(manifest.assets.filter((a) => a.lessonVersionId === lesson.lessonVersionId && a.role === "audio").map((a) => assetUrl(identity, a))));
      if (content && opened.current !== lesson.lessonVersionId) {
        opened.current = lesson.lessonVersionId;
        await recordEvent(identity, "lesson_opened", lesson.lessonVersionId);
        onEvent();
      }
    })();
    // onEvent chỉ cập nhật bộ đếm, không cần chạy lại khi nó đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, slug, position]);

  if (!loaded) return <p className={styles.muted}>Đang mở bài…</p>;
  if (loaded === "missing") return <div className={styles.card}><p className={styles.muted}>Không tìm thấy bài này trên máy. Kết nối mạng để tải.</p></div>;

  const { manifest, lesson, content } = loaded;
  if (license?.state === "locked" && !lesson.isFreeTrial) {
    return <div className={styles.card}><p className={styles.muted}>Bài này đang khóa vì đã quá hạn học offline. Kết nối mạng để đồng bộ rồi học tiếp.</p></div>;
  }
  if (!content) {
    return <div className={styles.card}><p className={styles.muted}>Bài này chưa được tải về máy. Khi có mạng, mở lại bài hoặc bấm “Tải khóa về máy” ở trang khóa.</p></div>;
  }

  async function toggleActivity(id: string) {
    if (doneActivities.has(id)) return;
    setDoneActivities(new Set(doneActivities).add(id));
    await recordEvent(identity, "activity_completed", lesson.lessonVersionId, { activityId: id });
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
      <div className={styles.actions}>
        <button className={styles.secondary} onClick={() => go({ khoa: slug })}>← Danh sách bài</button>
      </div>
      <div className={styles.card}>
        <p className={styles.muted}>Bài {lesson.externalId} · Câu hỏi phỏng vấn</p>
        <Bilingual text={content.question?.text} />
        {audio.map((src) => <audio key={src} className={styles.audio} controls src={src} />)}
        {audio.length === 0 && <p className={styles.muted}>Bài này chưa có âm thanh.</p>}
      </div>
      {!!content.key_points?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Ý bắt buộc</h2>
          {content.key_points.map((k) => <div key={k.id} className={styles.item}><Bilingual text={k.text} /></div>)}
        </div>
      )}
      {!!content.vocabulary?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Từ vựng</h2>
          {content.vocabulary.map((v) => <div key={v.id} className={styles.item}><Bilingual text={v.text} /></div>)}
        </div>
      )}
      <div className={styles.card}>
        <h2 className={styles.h2}>Đáp án mẫu</h2>
        {showAnswer ? <Bilingual text={content.model_answer?.text} /> : <p className={styles.muted}>Đáp án đang che. Tự nói câu trả lời bằng tiếng Anh trước.</p>}
        <p><button className={styles.secondary} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "Che đáp án" : "Xem đáp án"}</button></p>
      </div>
      {!!content.recall_cards?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Thẻ ôn</h2>
          {content.recall_cards.map((c) => (
            <div key={c.id} className={styles.item}>
              <Bilingual text={c.front} />
              {shownCards.has(c.id) ? <Bilingual text={c.back} /> : (
                <p><button className={styles.secondary} onClick={() => setShownCards(new Set(shownCards).add(c.id))}>Xem ý trả lời</button></p>
              )}
            </div>
          ))}
        </div>
      )}
      {!!content.follow_up_questions?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Câu hỏi tiếp theo</h2>
          {content.follow_up_questions.map((q) => <div key={q.id} className={styles.item}><Bilingual text={q.prompt} /></div>)}
        </div>
      )}
      {!!content.activities?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Hoạt động</h2>
          {[...content.activities].sort((a, b) => a.order - b.order).map((a) => (
            <label key={a.id} className={styles.check}>
              <input type="checkbox" checked={doneActivities.has(a.id)} disabled={doneActivities.has(a.id)} onChange={() => void toggleActivity(a.id)} />
              {ACTIVITY_LABEL[a.type] ?? a.type}
            </label>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <button className={styles.primary} disabled={completed} onClick={() => void finish()}>{completed ? "Đã học xong bài này" : "Đánh dấu đã học xong"}</button>
        {next && <button className={styles.secondary} onClick={() => go({ khoa: slug, bai: next.position })}>Bài tiếp →</button>}
      </div>
    </>
  );
}
