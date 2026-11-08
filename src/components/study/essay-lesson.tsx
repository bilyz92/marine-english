"use client";

import { useState, useSyncExternalStore } from "react";
import styles from "@/app/hoc/learn.module.css";
import study from "./study.module.css";
import type { LessonContent } from "@/components/lesson-body";
import { loadLessonState, updateLessonState } from "@/lib/study/storage";
import { SpeakButton, VoicePicker } from "@/components/speak";

// Bài tự luận (chủ 08/11/2026, docs/superpowers/plans/2026-11-08-course-modules.md, Task 4): học viên viết câu trả lời rồi tự đối chiếu
// với đáp án mẫu. Nháp chỉ lưu trên máy theo người học (học viên: localStorage, xóa khi đăng xuất; trang học thử: sessionStorage);
// học được khi mất mạng vì nội dung bài đã có trong manifest/IndexedDB.

type Text = { en?: string; vi?: string };

function Bilingual({ text, speak }: { text?: Text; speak?: boolean }) {
  return (
    <>
      {text?.en && <p className={styles.en}>{text.en}</p>}
      {text?.vi && <p className={styles.vi}>{text.vi}</p>}
      {speak && <SpeakButton text={text?.en} />}
    </>
  );
}

const noSubscription = () => () => {};

type Props = { externalId: string; content: LessonContent; who: string; children?: React.ReactNode };

/** Nháp nằm trong bộ nhớ trình duyệt: máy chủ dựng khung chờ, trình duyệt mới dựng bài (tránh lệch khi gắn React). */
export function EssayLesson(props: Props) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!mounted) return <div className={styles.card}><p className={styles.muted}>Đang mở bài…</p></div>;
  return <EssayBody key={`${props.who}|${props.externalId}`} {...props} />;
}

function EssayBody({ externalId, content, who, children }: Props) {
  const [draft, setDraft] = useState(() => loadLessonState(who, externalId).drafts?.essay ?? "");
  const [open, setOpen] = useState(false);

  function write(text: string) {
    setDraft(text);
    updateLessonState(who, externalId, { drafts: { ...loadLessonState(who, externalId).drafts, essay: text } });
  }

  const ready = draft.trim().length > 0;
  const points = content.key_points ?? [];
  return (
    <>
      <div className={styles.card}>
        <p className={styles.muted}>Bài {externalId} · Tự luận</p>
        <VoicePicker />
        <Bilingual text={content.question?.text} speak />
        {children}
      </div>
      {points.length > 0 && (
        <details className={styles.card}>
          <summary className={styles.h2}>Gợi ý: ý nên có ({points.length})</summary>
          {points.map((k) => <div key={k.id} className={styles.item}><Bilingual text={k.text} /></div>)}
        </details>
      )}
      <div className={styles.card}>
        <label className={styles.field}>
          <span>Bài viết của bạn (tiếng Anh)</span>
          <textarea className={study.textarea} rows={8} value={draft} onChange={(e) => write(e.target.value)} />
        </label>
        <p className={styles.muted}>Bài viết lưu trên máy này, không gửi đi đâu. Tự luyện, không tính điểm.</p>
      </div>
      <div className={styles.card}>
        <h2 className={styles.h2}>Đáp án mẫu</h2>
        {open && ready ? <Bilingual text={content.model_answer?.text} speak /> : (
          <p className={styles.muted}>{ready ? "Viết xong thì mở đáp án mẫu để tự so." : "Viết câu trả lời của bạn trước, rồi mới đối chiếu được."}</p>
        )}
        <p><button type="button" className={styles.secondary} disabled={!ready} onClick={() => setOpen(!open)}>{open && ready ? "Che đáp án" : "Đối chiếu đáp án mẫu"}</button></p>
        <p className={styles.muted}>Không cần giống từng chữ: đủ ý và đúng nghĩa là được.</p>
      </div>
    </>
  );
}
