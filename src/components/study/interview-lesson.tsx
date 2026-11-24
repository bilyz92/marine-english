"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import learn from "@/app/hoc/learn.module.css";
import {
  correctFirst, enterLesson, fillSlots, hash12, INTERVIEW_LEVELS, L1_STEPS, markSpoken, recordingKey, spokenFrom, targetReached, variantIndex,
  type InterviewLesson, type InterviewProgress, type Level, type Part, type Target,
} from "@/lib/study/interview";
import type { FieldDef, Profile } from "@/lib/study/personalize";
import { memoryStore, offlineStore, type RecordingStore } from "@/lib/study/recordings";
import { GUEST, loadInterview, loadProfile, saveInterview, saveProfile } from "@/lib/study/storage";
import { Listen, RecordPanel, useRecorder, useSpeaker, VoiceBar, type Recorder, type Speaker } from "./interview-audio";
import { ProfileFields } from "./lesson-study";
import styles from "./study.module.css";

// Bài luyện phỏng vấn 3 mức (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 6): L1 Tập từ đầu, L2 Luyện từng ý,
// L3 Đọc theo mẫu nâng cao. Chữ hiện nguyên văn tệp của chủ; giọng mẫu và ghi âm chỉ trên máy; chưa có chấm phát âm (chặng 3).

type Text = { en: string; vi: string };
const noSubscription = () => () => {};

type Props = {
  lesson: InterviewLesson;
  who: string;
  /** Mã băm phiên bản bài (manifest); khách học thử: không có, dùng chữ bài. */
  contentHash?: string;
  /** Học viên trên app (kho bản thu trên máy của người đó); không có = khách, bản thu chỉ trong bộ nhớ trang. */
  device?: { userId: string; deviceId: string };
  /** Đạt đích một mức lần đầu (gửi lesson_completed). */
  onComplete?: () => void;
  children?: React.ReactNode;
};

export function InterviewLessonView(props: Props) {
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!mounted) return <div className={learn.card}><p className={learn.muted}>Đang mở bài…</p></div>;
  // key: đổi bài hay đổi người thì dựng lại từ đầu (một lượt vào bài mới).
  return <Interview key={`${props.who}:${props.lesson.id}:${props.contentHash ?? ""}`} {...props} />;
}

function Interview({ lesson, who, contentHash, device, onComplete, children }: Props) {
  const hash = contentHash ?? hash12(JSON.stringify(lesson));
  // Lượt vào bài: tính một lần khi dựng (hàm khởi tạo thuần), ghi xuống máy một lần trong effect.
  const [progress, setProgress] = useState<InterviewProgress>(() => enterLesson(loadInterview(who, lesson.id), hash));
  const entered = useRef(false);
  useEffect(() => {
    if (entered.current) return;
    entered.current = true;
    saveInterview(who, lesson.id, progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ ghi lượt vào bài một lần
  }, []);
  const [profile, setProfile] = useState<Profile>(() => loadProfile(who));
  const [shift, setShift] = useState(0);
  const store = useMemo<RecordingStore>(() => (device && who !== GUEST ? offlineStore(device) : memoryStore()), [device, who]);
  const speaker = useSpeaker();
  const recorder = useRecorder(store);
  const level = progress.level ?? "L1";

  // Bản mới nhất (bản thu xong gọi lại sau vài giây, không dùng bản cũ của lúc bấm Ghi âm).
  const latest = useRef(progress);

  const p13n = lesson.personalization;
  const fill = (t: Text) => ({ en: fillSlots(t.en, { personalization: p13n, profile, lang: "en" }), vi: fillSlots(t.vi, { personalization: p13n, profile, lang: "vi" }) });
  const spoken = (t: Text) => spokenFrom(fill(t).en.parts).text;
  const key = (t: Target, text: Text) => recordingKey(lesson.id, t, spoken(text));
  const keys = {
    first: key({ level: "L1", id: "first" }, lesson.starter.first),
    basic: key({ level: "L2", id: "basic" }, lesson.basic),
    advanced: key({ level: "L3", id: "advanced" }, lesson.advanced),
  };
  // Mọi đích hiện có của bài: bản thu không khớp (chữ đổi, hồ sơ đổi) bị xóa khi mở bài.
  const allKeys = [
    keys.first, keys.basic, keys.advanced, key({ level: "L1", id: "basic" }, lesson.basic),
    ...lesson.segments.flatMap((s) => [key({ level: "L1", id: s.id }, s.text), key({ level: "L2", id: s.id }, s.text)]),
  ];
  const keepKey = allKeys.join(",");
  useEffect(() => {
    void store.prune(lesson.id, new Set(keepKey.split(","))).catch(() => undefined);
  }, [store, lesson.id, keepKey]);

  /** Ghi tiến độ; đạt đích của mức đang học lần đầu → đánh dấu xong bài đúng một lần. */
  const update = (patch: Partial<InterviewProgress> | ((p: InterviewProgress) => InterviewProgress)) => {
    const prev = latest.current;
    let next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
    const done = !next.completed && targetReached(next, next.level ?? "L1", keys);
    if (done) next = { ...next, completed: true };
    latest.current = next;
    saveInterview(who, lesson.id, next);
    setProgress(next);
    if (done) onComplete?.();
  };

  const variants = lesson.question.variants;
  const variant = variants[variantIndex(variants.length, progress.visits ?? 1, shift)] ?? { id: "q", text: lesson.question.text };
  const recorded = (englishHidden: boolean) => (k: string) => update((prev) => markSpoken(prev, k, englishHidden));
  const fields = (p13n?.fields ?? []) as FieldDef[];
  const missing = fields.filter((f) => !(f.type === "localized_text" ? profile[`${f.key}.en`]?.trim() : profile[f.key]?.trim()));
  const ctx: Ctx = { lesson, question: variant.text, speaker, recorder, fill, spoken, key, recorded };

  return (
    <>
      <div className={styles.levels} role="group" aria-label="Mức luyện">
        {INTERVIEW_LEVELS.map((l) => (
          <button key={l.id} type="button" className={l.id === level ? styles.levelOn : styles.level} aria-pressed={l.id === level}
            onClick={() => { speaker.stop(); recorder.cancel(); update({ level: l.id }); }}>
            <strong>{l.label}</strong>
            <span>{l.who}</span>
          </button>
        ))}
      </div>
      <div className={styles.layout}>
        <aside className={styles.side}>
          {/* Điện thoại: câu hỏi lên đầu, trên phần luyện. */}
          <div className={`${learn.card} ${styles.questionFirst}`}>
            <p className={learn.muted}>Câu {lesson.source_display_code} · {lesson.frequency_vi}</p>
            <VoiceBar speaker={speaker} />
            <p className={learn.en}>{variant.text.en}</p>
            {level !== "L3" && <p className={learn.vi}>{variant.text.vi}</p>}
            <div className={learn.actions}>
              <Listen speaker={speaker} id={`q:${variant.id}`} text={spokenFrom([{ kind: "text", text: variant.text.en }]).text} label="Nghe câu hỏi" />
              {variants.length > 1 && <button type="button" className={learn.secondary} onClick={() => { speaker.stop(); setShift(shift + 1); }}>Cách hỏi khác</button>}
            </div>
            {children}
          </div>
        </aside>
        <div className={styles.main}>
          {fields.length > 0 && <ProfileFields fields={fields} missing={missing} profile={profile} onSave={(p) => { setProfile(p); saveProfile(who, p); }} />}
          {recorder.problemText && <p className={learn.banner} role="alert">{recorder.problemText}</p>}
          {!store.persistent && <p className={learn.muted}>Bài học thử: bản thu chỉ giữ tới khi rời trang, không lưu trên máy.</p>}
          {level === "L1" && <L1 ctx={ctx} progress={progress} update={update} first={correctFirst(lesson.id, progress.visits ?? 1)} />}
          {level === "L2" && <L2 ctx={ctx} progress={progress} update={update} />}
          {level === "L3" && <L3 ctx={ctx} progress={progress} update={update} />}
          {progress.completed && <p className={styles.right} role="status">Đã xong bài này. Bạn có thể luyện thêm ở mức khác.</p>}
          <Criteria lesson={lesson} />
          {store.persistent && <ClearAll store={store} onCleared={recorder.refresh} />}
        </div>
      </div>
    </>
  );
}

type Ctx = {
  lesson: InterviewLesson; speaker: Speaker; recorder: Recorder;
  /** Cách hỏi đang hiện (theo lượt vào bài hoặc nút Cách hỏi khác). */
  question: Text;
  fill: (t: Text) => { en: { parts: Part[]; missing: FieldDef[] }; vi: { parts: Part[]; missing: FieldDef[] } };
  spoken: (t: Text) => string;
  key: (t: Target, text: Text) => string;
  recorded: (englishHidden: boolean) => (k: string) => void;
};
type StepProps = { ctx: Ctx; progress: InterviewProgress; update: (p: Partial<InterviewProgress>) => void };

/** Chữ có chỗ trống: chỗ đã điền đậm; chỗ chưa điền thành nhãn "chưa điền". */
function Filled({ parts, className }: { parts: Part[]; className: string }) {
  return (
    <p className={`${className} ${styles.pre}`}>
      {parts.map((p, i) => p.kind === "text" ? <span key={i}>{p.text}</span>
        : p.value ? <strong key={i} className={styles.slotOn}>{p.value}</strong>
        : <span key={i} className={styles.slot}>{p.field ? `chưa điền: ${p.field.label.vi}` : p.raw}</span>)}
    </p>
  );
}

/** Một câu song ngữ có nút Nghe; ẩn được từng dòng. */
function Line({ ctx, id, text, showEn = true, showVi = true, omitVi = false }: { ctx: Ctx; id: string; text: Text; showEn?: boolean; showVi?: boolean; omitVi?: boolean }) {
  const f = ctx.fill(text);
  const s = spokenFrom(f.en.parts);
  return (
    <>
      {showEn ? <Filled parts={f.en.parts} className={learn.en} /> : <p className={styles.hiddenLine}>Dòng tiếng Anh đã ẩn</p>}
      {text.vi && !(omitVi && !showVi) && (showVi ? <Filled parts={f.vi.parts} className={learn.vi} /> : <p className={styles.hiddenLine}>Dòng tiếng Việt đã ẩn</p>)}
      <Listen speaker={ctx.speaker} id={id} text={s.text} skipped={s.skipped} />
    </>
  );
}

function Rec({ ctx, level, id, text, englishHidden = false, hint }: { ctx: Ctx; level: Level; id: string; text: Text; englishHidden?: boolean; hint?: string }) {
  const k = ctx.key({ level, id }, text);
  return (
    <RecordPanel recorder={ctx.recorder} speaker={ctx.speaker} recKey={k} lessonId={ctx.lesson.id} sample={ctx.spoken(text)} sampleId={`mau:${k}`}
      onRecorded={ctx.recorded(englishHidden)} hint={hint} />
  );
}

function StepHead({ at, total, title }: { at: number; total: number; title: string }) {
  return (
    <>
      <div className={styles.stepHead}><span className={styles.stepCount}>Bước {at + 1}/{total}</span><span className={learn.muted}>{title}</span></div>
      <div className={styles.bar}><div className={styles.barFill} style={{ width: `${((at + 1) / total) * 100}%` }} /></div>
    </>
  );
}

const L1_TITLES = ["Nghe hướng dẫn", "Hiểu câu hỏi", "Cụm từ then chốt", "Nói câu đầu", "Ôn cả đáp án cơ bản"];

function L1({ ctx, progress, update, first }: StepProps & { first: boolean }) {
  const { lesson, speaker } = ctx;
  const st = progress.L1 ?? {};
  const at = Math.min(st.step ?? 0, L1_STEPS - 1);
  const [wrong, setWrong] = useState<string | null>(null);
  const set = (patch: Partial<NonNullable<InterviewProgress["L1"]>>) => update({ L1: { ...st, ...patch } });
  const go = (n: number) => { speaker.stop(); ctx.recorder.cancel(); setWrong(null); set({ step: n }); };
  const s = lesson.starter;
  const options = first ? [s.correct_vi, s.distractor_vi] : [s.distractor_vi, s.correct_vi];

  function choose(option: string) {
    if (option === s.correct_vi) {
      setWrong(null);
      set({ understood: true });
      return;
    }
    // LEARN01: chọn sai → phát lại cụm nghe, hiện nghĩa và cả câu.
    setWrong(option);
    speaker.play("l1:sai", `${ctx.spoken(s.phrase)} ... ${ctx.spoken(ctx.question)}`);
  }

  return (
    <div className={`${learn.card} ${styles.step}`} aria-live="polite">
      <StepHead at={at} total={L1_STEPS} title={L1_TITLES[at]!} />
      {at === 0 && (
        <>
          <p className={learn.note}>{s.lead_vi}</p>
          <Listen speaker={speaker} id="l1:dan" text={s.lead_vi} lang="vi" label="Nghe hướng dẫn" />
          {s.instruction_vi && <p className={styles.answerLabel}>Việc của bạn: {s.instruction_vi}</p>}
        </>
      )}
      {at === 1 && (
        <>
          <p className={learn.note}>Nghe câu hỏi ở trên rồi chọn ý đúng: người phỏng vấn đang hỏi về điều gì?</p>
          <div className={styles.options}>
            {options.map((o) => (
              <button key={o} type="button" className={st.understood && o === s.correct_vi ? styles.optionRight : wrong === o ? styles.optionWrong : styles.option}
                aria-pressed={(st.understood && o === s.correct_vi) || wrong === o} onClick={() => choose(o)}>{o}</button>
            ))}
          </div>
          {wrong && !st.understood && (
            <div className={styles.answer}>
              <p className={styles.wrong}>Chưa đúng. Nghe lại cụm then chốt và câu hỏi:</p>
              <Line ctx={ctx} id="l1:cum-sai" text={s.phrase} />
              <p className={learn.en}>{ctx.question.en}</p>
              <p className={learn.vi}>{ctx.question.vi}</p>
            </div>
          )}
          {st.understood && <p className={styles.right}>Đúng rồi: {s.correct_vi}.</p>}
        </>
      )}
      {at === 2 && (
        <>
          <Line ctx={ctx} id="l1:cum" text={s.phrase} />
          {s.extra && <div className={styles.answer}><p className={styles.answerLabel}>Từ nghe thêm</p><Line ctx={ctx} id="l1:them" text={s.extra} /></div>}
        </>
      )}
      {at === 3 && (
        <>
          <Line ctx={ctx} id="l1:cau-dau" text={s.first} showEn={!st.hideEn} showVi={!st.hideVi} />
          <div className={learn.actions}>
            <button type="button" className={styles.toggle} aria-pressed={!!st.hideEn} onClick={() => set({ hideEn: !st.hideEn, ...(st.hideEn ? { hideVi: false } : {}) })}>
              {st.hideEn ? "Hiện tiếng Anh" : "Ẩn tiếng Anh"}
            </button>
            <button type="button" className={styles.toggle} disabled={!st.hideEn} aria-pressed={!!st.hideVi} onClick={() => set({ hideVi: !st.hideVi })}>
              {st.hideVi ? "Hiện tiếng Việt" : "Ẩn tiếng Việt"}
            </button>
          </div>
          <Rec ctx={ctx} level="L1" id="first" text={s.first} englishHidden={!!st.hideEn}
            hint={st.hideEn ? "Đã ẩn tiếng Anh: tự nói câu này rồi ghi âm." : "Đọc theo và ghi âm. Sau đó ẩn tiếng Anh, tự nói lại và ghi âm để xong mức này."} />
          {!st.understood && <p className={learn.muted}>Quay lại bước 2 để chọn đúng ý câu hỏi.</p>}
        </>
      )}
      {at === 4 && (
        <>
          <p className={learn.note}>Các ý còn lại của đáp án cơ bản. Nghe từng đoạn, ghi âm nếu muốn.</p>
          {lesson.segments.map((seg) => (
            <div key={seg.id} className={styles.seg2}>
              <Line ctx={ctx} id={`l1:${seg.id}`} text={seg.text} />
              <Rec ctx={ctx} level="L1" id={seg.id} text={seg.text} />
            </div>
          ))}
          <div className={styles.answer}>
            <p className={styles.answerLabel}>Cả đáp án cơ bản</p>
            <SampleNote lesson={lesson} text={lesson.basic} />
            <Line ctx={ctx} id="l1:co-ban" text={lesson.basic} />
            <Rec ctx={ctx} level="L1" id="basic" text={lesson.basic} />
          </div>
        </>
      )}
      <div className={styles.nav}>
        <button type="button" className={learn.secondary} disabled={at === 0} onClick={() => go(at - 1)}>← Trước</button>
        <button type="button" className={learn.primary} disabled={at === L1_STEPS - 1 || (at === 1 && !st.understood)} onClick={() => go(at + 1)}>Tiếp theo →</button>
      </div>
    </div>
  );
}

function L2({ ctx, progress, update }: StepProps) {
  const { lesson, speaker } = ctx;
  const st = progress.L2 ?? {};
  const total = lesson.segments.length;
  const at = Math.min(st.segment ?? 0, total);
  const [showVi, setShowVi] = useState(true);
  const set = (patch: Partial<NonNullable<InterviewProgress["L2"]>>) => update({ L2: { ...st, ...patch } });
  const go = (n: number) => { speaker.stop(); ctx.recorder.cancel(); set({ segment: n }); };
  const seg = lesson.segments[at];
  return (
    <div className={`${learn.card} ${styles.step}`} aria-live="polite">
      <StepHead at={at} total={total + 1} title={seg ? `Đoạn ${at + 1}/${total}` : "Ghép cả đáp án"} />
      <div className={learn.actions}>
        <button type="button" className={styles.toggle} aria-pressed={!!st.keywords} onClick={() => set({ keywords: !st.keywords })}>{st.keywords ? "Hiện mẫu" : "Chỉ giữ từ khóa"}</button>
        <button type="button" className={styles.toggle} aria-pressed={!showVi} onClick={() => setShowVi(!showVi)}>{showVi ? "Ẩn nghĩa" : "Xem nghĩa"}</button>
      </div>
      {seg ? (
        <>
          {st.keywords ? <p className={learn.en}>Gợi ý: {seg.keyword || "…"}</p> : null}
          <Line ctx={ctx} id={`l2:${seg.id}`} text={seg.text} showEn={!st.keywords} showVi={showVi} />
          <Rec ctx={ctx} level="L2" id={seg.id} text={seg.text} hint="Nghe, dừng lại đọc theo, rồi ghi âm đoạn này." />
        </>
      ) : (
        <>
          {st.keywords && <p className={learn.en}>Gợi ý: {lesson.segments.map((s) => s.keyword).filter(Boolean).join(" → ")}</p>}
          <SampleNote lesson={lesson} text={lesson.basic} />
          <Line ctx={ctx} id="l2:co-ban" text={lesson.basic} showEn={!st.keywords} showVi={showVi} />
          <Rec ctx={ctx} level="L2" id="basic" text={lesson.basic} hint="Nói liền cả đáp án cơ bản rồi ghi âm một lượt để xong mức này." />
        </>
      )}
      <div className={styles.nav}>
        <button type="button" className={learn.secondary} disabled={at === 0} onClick={() => go(at - 1)}>← Trước</button>
        <button type="button" className={learn.primary} disabled={at === total} onClick={() => go(at + 1)}>{at + 1 === total ? "Ghép cả bài →" : "Đoạn tiếp →"}</button>
      </div>
    </div>
  );
}

function L3({ ctx, progress, update }: StepProps) {
  const { lesson } = ctx;
  const st = progress.L3 ?? {};
  const [guide, setGuide] = useState(false);
  const [showVi, setShowVi] = useState(false);
  const showText = st.showText !== false;
  return (
    <div className={`${learn.card} ${styles.step}`}>
      <h2 className={learn.h2}>Đáp án nâng cao</h2>
      <SampleNote lesson={lesson} text={lesson.advanced} />
      <div className={learn.actions}>
        <button type="button" className={styles.toggle} aria-pressed={!showText} onClick={() => update({ L3: { ...st, showText: !showText } })}>{showText ? "Ẩn chữ" : "Hiện chữ"}</button>
        <button type="button" className={styles.toggle} aria-pressed={showVi} onClick={() => setShowVi(!showVi)}>{showVi ? "Ẩn bản dịch" : "Xem bản dịch"}</button>
        {lesson.advanced.guidance_vi && <button type="button" className={styles.toggle} aria-expanded={guide} onClick={() => setGuide(!guide)}>{guide ? "Ẩn hướng dẫn" : "Xem hướng dẫn"}</button>}
      </div>
      {guide && <p className={learn.note}>{lesson.advanced.guidance_vi}</p>}
      <div className={styles.multi}><Line ctx={ctx} id="l3:nang-cao" text={lesson.advanced} showEn={showText} showVi={showVi} omitVi /></div>
      <Rec ctx={ctx} level="L3" id="advanced" text={lesson.advanced} hint="Đọc theo mẫu (hoặc tự nói khi đã ẩn chữ) rồi ghi âm và nghe lại." />
    </div>
  );
}

/**
 * Câu mẫu có thông tin của người khác (EC-001: "Hùng, 33 tuổi…", EC-013: môn học): câu đầu của bài có chỗ trống để tự điền
 * mà đáp án lại không có chỗ trống nào. Chữ giữ nguyên văn, chỉ nhắc học viên thay bằng thông tin thật (Quyết định 6).
 */
function SampleNote({ lesson, text }: { lesson: InterviewLesson; text: Text }) {
  if (!/\{[^{}]+\}/.test(lesson.starter.first.en) || /\{[^{}]+\}|\[[^\]]+\]/.test(text.en)) return null;
  return <p className={learn.banner}>Câu mẫu: thay tên, tuổi, trường, môn học… bằng thông tin thật của bạn khi trả lời.</p>;
}

/** Ý chuyên môn của ngân hàng: chỉ để tự đối chiếu, không chấm. */
function Criteria({ lesson }: { lesson: InterviewLesson }) {
  const [open, setOpen] = useState(false);
  if (!lesson.bank.criteria_vi && !lesson.bank.model_answer_vi) return null;
  return (
    <div className={learn.card}>
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Ẩn ý chuyên môn" : "Ý chuyên môn cần có"}</button>
      {open && (
        <div className={styles.multi}>
          {lesson.bank.model_answer_vi && <><p className={styles.answerLabel}>Đáp án mẫu tiếng Việt</p><p className={learn.note}>{lesson.bank.model_answer_vi}</p></>}
          {lesson.bank.criteria_vi && <><p className={styles.answerLabel}>Tiêu chí đánh giá</p><p className={learn.note}>{lesson.bank.criteria_vi}</p></>}
        </div>
      )}
    </div>
  );
}

function ClearAll({ store, onCleared }: { store: RecordingStore; onCleared: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <p>
      <button type="button" className={styles.toggle} onClick={() => void store.clearAll().then(() => { setDone(true); onCleared(); }, () => undefined)}>Xóa mọi bản thu của tôi trên máy này</button>
      {done && <span className={styles.saved}> Đã xóa mọi bản thu.</span>}
    </p>
  );
}
