"use client";

import { useState } from "react";
import styles from "@/app/hoc/learn.module.css";

type Text = { en?: string; vi?: string };
export type LessonContent = {
  question?: { text?: Text };
  key_points?: { id: string; text?: Text }[];
  vocabulary?: { id: string; text?: Text }[];
  model_answer?: { text?: Text };
  follow_up_questions?: { id: string; prompt?: Text }[];
  recall_cards?: { id: string; front?: Text; back?: Text }[];
  activities?: { id: string; order: number; type: string; requires_microphone?: boolean }[];
};

function Bilingual({ text }: { text?: Text }) {
  return (
    <>
      {text?.en && <p className={styles.en}>{text.en}</p>}
      {text?.vi && <p className={styles.vi}>{text.vi}</p>}
    </>
  );
}

/** Phần nội dung bài ba mức, dùng chung cho app học và trang học thử. `children` đặt dưới câu hỏi (âm thanh). */
export function LessonBody({ externalId, content, children }: { externalId: string; content: LessonContent; children?: React.ReactNode }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [shownCards, setShownCards] = useState<Set<string>>(new Set());
  return (
    <>
      <div className={styles.card}>
        <p className={styles.muted}>Bài {externalId} · Câu hỏi phỏng vấn</p>
        <Bilingual text={content.question?.text} />
        {children}
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
    </>
  );
}
