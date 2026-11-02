"use client";

import { useState } from "react";
import styles from "@/app/hoc/learn.module.css";
import { SpeakButton, VoicePicker } from "./speak";

type Text = { en?: string; vi?: string };
type FollowUp = { id: string; prompt?: Text };
export type LessonContent = {
  question?: { text?: Text };
  key_points?: { id: string; text?: Text }[];
  // Engine Cadet: {id, text:{en,vi}}; Oiler, Wiper: {en, vi}.
  vocabulary?: ({ id?: string; text?: Text } & Text)[];
  model_answer?: { text?: Text };
  follow_up_questions?: FollowUp[];
  // Câu phụ lưu ở bài khác của cùng bộ (Oiler, Wiper), bộ nhập chép sang.
  linked_follow_up_questions?: FollowUp[];
  recall_cards?: { id: string; front?: Text; back?: Text }[];
  activities?: { id: string; order: number; type: string; requires_microphone?: boolean }[];
};

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

/** Phần nội dung bài, dùng chung cho app học và trang học thử. `children` đặt dưới câu hỏi (âm thanh). */
export function LessonBody({ externalId, content, children }: { externalId: string; content: LessonContent; children?: React.ReactNode }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [shownCards, setShownCards] = useState<Set<string>>(new Set());
  const vocabulary = (content.vocabulary ?? []).map((v) => v.text ?? { en: v.en, vi: v.vi }).filter(hasText);
  const followUps = [...(content.follow_up_questions ?? []), ...(content.linked_follow_up_questions ?? [])];
  return (
    <>
      <div className={styles.card}>
        <p className={styles.muted}>Bài {externalId} · Câu hỏi phỏng vấn</p>
        <VoicePicker />
        <Bilingual text={content.question?.text} speak />
        {children}
      </div>
      {!!content.key_points?.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Ý bắt buộc</h2>
          {content.key_points.map((k) => <div key={k.id} className={styles.item}><Bilingual text={k.text} speak /></div>)}
        </div>
      )}
      {!!vocabulary.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Từ vựng</h2>
          {vocabulary.map((v, i) => <div key={i} className={styles.item}><Bilingual text={v} speak /></div>)}
        </div>
      )}
      {hasText(content.model_answer?.text) && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Đáp án mẫu</h2>
          {showAnswer ? <Bilingual text={content.model_answer?.text} speak /> : <p className={styles.muted}>Đáp án đang che. Tự nói câu trả lời bằng tiếng Anh trước.</p>}
          <p><button className={styles.secondary} onClick={() => setShowAnswer(!showAnswer)}>{showAnswer ? "Che đáp án" : "Xem đáp án"}</button></p>
        </div>
      )}
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
      {!!followUps.length && (
        <div className={styles.card}>
          <h2 className={styles.h2}>Câu hỏi tiếp theo</h2>
          {followUps.map((q) => <div key={q.id} className={styles.item}><Bilingual text={q.prompt} speak /></div>)}
        </div>
      )}
    </>
  );
}
