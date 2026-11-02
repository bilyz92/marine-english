"use client";

import { useState, useSyncExternalStore } from "react";
import learn from "@/app/hoc/learn.module.css";
import { checkExercise, type Exercise } from "@/lib/study/exercise";
import { pickAlternative, ENUM_LABEL_VI, type Alternative } from "@/lib/study/alternatives";
import { defaultLevel, LEVELS, levelData, missingFor, type LevelId, type StudyLesson } from "@/lib/study/levels";
import { personalize, type FieldDef, type Profile } from "@/lib/study/personalize";
import { loadAccountLevel, loadLessonState, loadProfile, saveAccountLevel, saveLessonState, saveProfile, type LessonState } from "@/lib/study/storage";
import { SpeakButton, VoicePicker } from "../speak";
import styles from "./study.module.css";

// Giao diện học 3 mức trên cùng một bài (docs/superpowers/plans/2026-11-03-three-level-study.md).
// Chỉ hiện chữ có trong dữ liệu; không chấm điểm, không coi là đạt bài. Hồ sơ, mức, bản nháp lưu trên máy.

type Text = { en?: string; vi?: string };
const noSubscription = () => () => {};

export function LessonStudy({ externalId, lesson, who, children }: { externalId: string; lesson: StudyLesson; who: string; children?: React.ReactNode }) {
  // Chỉ dựng trên trình duyệt: trạng thái lưu trên máy, tránh lệch khi dựng sẵn ở máy chủ.
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!mounted) return <div className={learn.card}><p className={learn.muted}>Đang mở bài…</p></div>;
  // key: sang bài khác thì dựng lại, không mang bản nháp, bước, mức của bài trước sang.
  return <Study key={`${who}:${lesson.id}`} externalId={externalId} lesson={lesson} who={who}>{children}</Study>;
}

function Study({ externalId, lesson, who, children }: { externalId: string; lesson: StudyLesson; who: string; children?: React.ReactNode }) {
  const [state, setState] = useState<LessonState>(() => {
    const saved = loadLessonState(who, lesson.id);
    return { ...saved, level: defaultLevel({ lesson: saved.level, account: loadAccountLevel(who) }) };
  });
  const [profile, setProfile] = useState<Profile>(() => loadProfile(who));
  const level = state.level ?? "foundation";
  const update = (patch: Partial<LessonState>) => {
    const next = { ...state, ...patch };
    setState(next);
    saveLessonState(who, lesson.id, next);
  };
  const answers = state.exercises ?? {};
  const setAnswer: SetAnswer = (id, a) => update({ exercises: { ...answers, [id]: a } });
  const chooseLevel = (id: LevelId) => {
    update({ level: id });
    saveAccountLevel(who, id);
  };

  const bindings = lesson.personalization?.bindings ?? [];
  // scope: phạm vi điền chỗ trống (câu phụ liên kết dùng bài gốc của nó); mỗi ngôn ngữ chỉ nhận giá trị của ngôn ngữ đó.
  const fill: Fill = (t, scope = lesson.id) => ({
    en: t?.en ? personalize(t.en, { bindings, scope, profile, lang: "en" }).text : undefined,
    vi: t?.vi ? personalize(t.vi, { bindings, scope, profile, lang: "vi" }).text : undefined,
  });
  const data = levelData(lesson, level);
  const missing = missingFor(lesson, level, state.step ?? 0, profile);
  const fields = lesson.personalization?.fields ?? [];

  return (
    <>
      <div className={learn.card}>
        <p className={learn.muted}>Bài {externalId} · Câu hỏi phỏng vấn</p>
        <VoicePicker />
        <p className={learn.en}>{lesson.question?.text?.en}</p>
        {level !== "independent" && lesson.question?.text?.vi && <p className={learn.vi}>{lesson.question.text.vi}</p>}
        <SpeakButton text={lesson.question?.text?.en} label="Nghe câu hỏi" />
        {children}
      </div>

      <div className={styles.levels} role="group" aria-label="Mức hỗ trợ tiếng Anh">
        {LEVELS.map((l) => (
          <button key={l.id} type="button" className={l.id === level ? styles.levelOn : styles.level} aria-pressed={l.id === level} onClick={() => chooseLevel(l.id)}>
            <strong>{l.label}</strong>
            <span>{l.hint}</span>
          </button>
        ))}
      </div>

      {fields.length > 0 && <ProfileFields fields={fields} missing={missing} profile={profile} onSave={(p) => { setProfile(p); saveProfile(who, p); }} />}
      {data.task?.vi && <p className={learn.note}>{data.task.vi}</p>}

      {level === "foundation" && <Foundation lesson={lesson} data={data} fill={fill} profile={profile} step={state.step ?? 0} setStep={(s) => update({ step: s })} onNext={() => chooseLevel("developing")} answers={answers} setAnswer={setAnswer} />}
      {level === "developing" && (
        <Developing data={data} fill={fill} profile={profile} answers={answers} setAnswer={setAnswer} model={lesson.model_answer} recall={lesson.recall_cards} draft={state.drafts?.developing ?? ""} said={!!state.said?.developing}
          setDraft={(t) => update({ drafts: { ...state.drafts, developing: t } })} setSaid={() => update({ said: { ...state.said, developing: true } })} />
      )}
      {level === "independent" && (
        <Independent lesson={lesson} data={data} fill={fill} profile={profile} draft={state.drafts?.independent ?? ""} said={!!state.said?.independent}
          setDraft={(t) => update({ drafts: { ...state.drafts, independent: t } })} setSaid={() => update({ said: { ...state.said, independent: true } })} />
      )}
    </>
  );
}

type Fill = (t?: Text, scope?: string) => Text;
type Data = ReturnType<typeof levelData>;

/** Trường song ngữ (localized_text) có hai ô: tiếng Anh dùng cho câu tiếng Anh, tiếng Việt cho câu tiếng Việt. */
const keysOf = (f: FieldDef) => (f.type === "localized_text" ? [`${f.key}.en`, `${f.key}.vi`] : [f.key]);

function ProfileFields({ fields, missing, profile, onSave }: { fields: FieldDef[]; missing: FieldDef[]; profile: Profile; onSave: (p: Profile) => void }) {
  // Điền từ dải nhắc: chỉ các trường phần đang hiện cần. "Sửa thông tin": mọi trường của bài.
  const [shown, setShown] = useState<FieldDef[] | null>(null);
  const [draft, setDraft] = useState<Profile>(profile);
  const [problem, setProblem] = useState<string | null>(null);
  const open = (list: FieldDef[]) => { setDraft(profile); setProblem(null); setShown(list); };
  if (!shown) {
    return missing.length > 0 ? (
      <div className={learn.banner}>
        Điền thông tin thật của bạn để đáp án mẫu dùng đúng: {missing.map((f) => f.label.vi).join(", ")}.{" "}
        <button type="button" className={styles.toggle} onClick={() => open(missing)}>Điền thông tin</button>
      </div>
    ) : (
      <p><button type="button" className={styles.toggle} onClick={() => open(fields)}>Sửa thông tin của bạn</button></p>
    );
  }
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of shown) {
      const v = draft[f.key];
      if (f.type !== "integer" || typeof v !== "string" || !v.trim()) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
        return setProblem(`${f.label.vi}: nhập số nguyên${f.min !== undefined && f.max !== undefined ? ` từ ${f.min} đến ${f.max}` : ""}.`);
      }
    }
    onSave(draft);
    setShown(null);
  };
  return (
    <form className={`${learn.card} ${styles.profile}`} onSubmit={save}>
      <h2 className={learn.h2}>Thông tin của bạn</h2>
      <p className={learn.muted}>Chỉ lưu trên máy này, dùng để điền vào đáp án mẫu; đăng xuất thì xóa. Chưa có thì để trống, đừng ghi điều chưa làm.</p>
      {shown.flatMap((f) => keysOf(f).map((k) => {
        const label = `${f.label.vi}${k.endsWith(".en") ? " (tiếng Anh)" : k.endsWith(".vi") ? " (tiếng Việt)" : ""}`;
        const value = typeof draft[k] === "string" ? draft[k] : "";
        const set = (v: string) => setDraft({ ...draft, [k]: v });
        return (
          <label key={k} className={learn.field}>
            {label}
            {f.type === "enum" && f.values ? (
              <select className={learn.input} value={value} onChange={(e) => set(e.target.value)}>
                <option value="">Chưa chọn</option>
                {f.values.map((v) => <option key={v} value={v}>{ENUM_LABEL_VI[v] ?? v}</option>)}
              </select>
            ) : f.type === "integer" ? (
              <input className={learn.input} type="number" inputMode="numeric" step={1} min={f.min} max={f.max} value={value} onChange={(e) => set(e.target.value)} />
            ) : (
              <input className={learn.input} type={f.type === "date" ? "date" : "text"} maxLength={200} value={value} onChange={(e) => set(e.target.value)} />
            )}
          </label>
        );
      }))}
      {problem && <p className={learn.bannerDanger} role="alert">{problem}</p>}
      <div className={learn.actions}>
        <button className={learn.primary}>Lưu thông tin</button>
        <button type="button" className={learn.secondary} onClick={() => setShown(null)}>Để sau</button>
      </div>
    </form>
  );
}

/** Câu chọn theo hồ sơ, kèm các câu "Nếu …" còn phải tự đối chiếu. */
function Picked({ base, alts, fill, profile }: { base?: Text; alts?: Alternative[]; fill: Fill; profile: Profile }) {
  const r = pickAlternative(base, alts, profile);
  return (
    <>
      <Bilingual text={fill(r.text)} speak />
      {r.choices.length > 0 && <ul className={styles.alts}>{r.choices.map((a, i) => <li key={i}>{a.when_vi}: {fill(a.text).en}</li>)}</ul>}
    </>
  );
}

function Bilingual({ text, speak, vi = true }: { text: Text; speak?: boolean; vi?: boolean }) {
  return (
    <>
      {text.en && <p className={learn.en}>{text.en}</p>}
      {vi && text.vi && <p className={learn.vi}>{text.vi}</p>}
      {speak && <SpeakButton text={text.en} />}
    </>
  );
}

type Answers = NonNullable<LessonState["exercises"]>;
type SetAnswer = (id: string, a: Answers[string]) => void;

function Foundation({ lesson, data, fill, profile, step, setStep, onNext, answers, setAnswer }: { lesson: StudyLesson; data: Data; fill: Fill; profile: Profile; step: number; setStep: (s: number) => void; onNext: () => void; answers: Answers; setAnswer: SetAnswer }) {
  const [shown, setShown] = useState<string | null>(null);
  const [showVi, setShowVi] = useState(true);
  const total = data.steps.length;
  const at = Math.min(step, total);
  const current = data.steps[at];
  return (
    <>
      {data.phrases.length > 0 && (
        <div className={learn.card}>
          <h2 className={learn.h2}>Cụm từ hữu ích</h2>
          <div className={styles.chips}>{data.phrases.map((p, i) => <span key={i} className={styles.chip}>{p.en}{p.vi ? ` · ${p.vi}` : ""}</span>)}</div>
        </div>
      )}
      <Vocabulary lesson={lesson} />
      {current ? (
        <div className={learn.card} aria-live="polite">
          <div className={styles.stepHead}>
            <span className={styles.stepCount}>Bước {at + 1}/{total}</span>
            <button type="button" className={styles.toggle} onClick={() => setShowVi(!showVi)}>{showVi ? "Ẩn nghĩa" : "Hiện nghĩa"}</button>
          </div>
          <div className={styles.bar}><div className={styles.barFill} style={{ width: `${((at + 1) / total) * 100}%` }} /></div>
          <Bilingual text={fill(current.question)} vi={showVi} speak />
          {shown === current.id ? (
            <div className={styles.answer}>
              <p className={styles.answerLabel}>Đáp án ngắn</p>
              <Picked base={current.short_answer} alts={current.short_answer_alternatives} fill={fill} profile={profile} />
            </div>
          ) : (
            <p className={learn.muted}>Tự nói câu trả lời trước, rồi mới xem đáp án.</p>
          )}
          <p><button type="button" className={styles.toggle} onClick={() => setShown(shown === current.id ? null : current.id)}>{shown === current.id ? "Ẩn đáp án" : "Xem đáp án"}</button></p>
          <div className={styles.nav}>
            <button type="button" className={learn.secondary} disabled={at === 0} onClick={() => { setShown(null); setStep(at - 1); }}>← Trước</button>
            <button type="button" className={learn.primary} onClick={() => { setShown(null); setStep(at + 1); }}>{at + 1 === total ? "Xong các bước" : "Tiếp theo →"}</button>
          </div>
        </div>
      ) : (
        <div className={learn.card}>
          <h2 className={learn.h2}>Đã học xong {total} bước nhỏ</h2>
          <p className={learn.muted}>Làm bài tập bên dưới, rồi thử trả lời cả câu ở Mức 2.</p>
          <div className={styles.nav}>
            <button type="button" className={learn.secondary} onClick={() => setStep(0)}>Học lại từ bước 1</button>
            <button type="button" className={learn.primary} onClick={onNext}>Sang Mức 2 →</button>
          </div>
        </div>
      )}
      {/* Bài tập Mức 1 sau khi học xong các bước nhỏ. */}
      {!current && data.exercises.length > 0 && <Exercises items={data.exercises} fill={fill} answers={answers} setAnswer={setAnswer} />}
    </>
  );
}

/** Từ vựng của bài (Engine Cadet: {text:{en,vi}}; Oiler, Wiper: {en,vi}). */
function Vocabulary({ lesson }: { lesson: StudyLesson }) {
  const words = (lesson.vocabulary ?? []).map((v) => v.text ?? { en: v.en, vi: v.vi }).filter((t) => t.en || t.vi);
  if (!words.length) return null;
  return (
    <div className={learn.card}>
      <h2 className={learn.h2}>Từ vựng</h2>
      {words.map((w, i) => <div key={i} className={learn.item}><Bilingual text={w} speak /></div>)}
    </div>
  );
}

function RecallCards({ cards, fill }: { cards: StudyLesson["recall_cards"]; fill: Fill }) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  if (!cards?.length) return null;
  return (
    <div className={learn.card}>
      <h2 className={learn.h2}>Thẻ ôn</h2>
      {cards.map((c) => (
        <div key={c.id} className={learn.item}>
          <Bilingual text={fill(c.front)} />
          {shown.has(c.id) ? <Bilingual text={fill(c.back)} /> : (
            <p><button type="button" className={styles.toggle} onClick={() => setShown(new Set(shown).add(c.id))}>Xem ý trả lời</button></p>
          )}
        </div>
      ))}
    </div>
  );
}

function Attempt({ draft, setDraft, said, setSaid }: { draft: string; setDraft: (t: string) => void; said: boolean; setSaid: () => void }) {
  return (
    <div className={learn.card}>
      <label className={learn.field}>
        Câu trả lời của tôi (tiếng Anh, lưu nháp trên máy)
        <textarea className={styles.textarea} value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      {!said && <p><button type="button" className={styles.toggle} onClick={setSaid}>Tôi đã tự nói câu trả lời</button></p>}
    </div>
  );
}

function ModelAnswer({ model, fill, profile, ready, extra }: { model?: StudyLesson["model_answer"]; fill: Fill; profile: Profile; ready: boolean; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!model?.text) return null;
  return (
    <div className={learn.card}>
      <h2 className={learn.h2}>Đáp án mẫu</h2>
      {!ready && <p className={learn.muted}>Viết câu trả lời hoặc bấm “Tôi đã tự nói câu trả lời” rồi mới đối chiếu.</p>}
      {ready && open && (
        <div className={styles.answer}>
          <Picked base={model.text} alts={model.alternatives} fill={fill} profile={profile} />
          {extra}
        </div>
      )}
      <p><button type="button" className={styles.toggle} disabled={!ready} onClick={() => setOpen(!open)}>{open && ready ? "Che đáp án" : "Đối chiếu đáp án mẫu"}</button></p>
      <p className={learn.muted}>Không cần giống từng chữ: đủ ý và đúng nghĩa là được.</p>
    </div>
  );
}

function KeyPoints({ points, fill }: { points: Data["keyPoints"]; fill: Fill }) {
  if (!points.length) return null;
  return (
    <div className={learn.card}>
      <h2 className={learn.h2}>{points.length} ý cần nói</h2>
      {points.map((k) => <div key={k.id} className={learn.item}><Bilingual text={fill(k.text)} speak /></div>)}
    </div>
  );
}

function Developing({ data, fill, profile, answers, setAnswer, model, recall, draft, said, setDraft, setSaid }: { data: Data; fill: Fill; profile: Profile; answers: Answers; setAnswer: SetAnswer; model: StudyLesson["model_answer"]; recall: StudyLesson["recall_cards"]; draft: string; said: boolean; setDraft: (t: string) => void; setSaid: () => void }) {
  return (
    <>
      <KeyPoints points={data.keyPoints} fill={fill} />
      <RecallCards cards={recall} fill={fill} />
      <Attempt draft={draft} setDraft={setDraft} said={said} setSaid={setSaid} />
      <ModelAnswer model={model} fill={fill} profile={profile} ready={said || !!draft.trim()} />
      {data.exercises.length > 0 && <Exercises items={data.exercises} fill={fill} answers={answers} setAnswer={setAnswer} />}
    </>
  );
}

function Independent({ lesson, data, fill, profile, draft, said, setDraft, setSaid }: { lesson: StudyLesson; data: Data; fill: Fill; profile: Profile; draft: string; said: boolean; setDraft: (t: string) => void; setSaid: () => void }) {
  const [variant, setVariant] = useState(-1);
  const [viOpen, setViOpen] = useState(false);
  const ready = said || !!draft.trim();
  const asked = variant >= 0 ? data.variants[variant]?.text : lesson.question?.text;
  return (
    <>
      <div className={learn.card}>
        <h2 className={learn.h2}>Câu hỏi</h2>
        <Bilingual text={{ en: asked?.en }} speak />
        {viOpen && asked?.vi && <p className={learn.vi}>{asked.vi}</p>}
        <div className={learn.actions}>
          {data.variants.length > 0 && <button type="button" className={styles.toggle} onClick={() => setVariant((variant + 1) % data.variants.length)}>Đổi cách hỏi</button>}
          <button type="button" className={styles.toggle} onClick={() => setViOpen(!viOpen)}>{viOpen ? "Ẩn nghĩa" : "Xem nghĩa (trợ giúp)"}</button>
        </div>
      </div>
      <Attempt draft={draft} setDraft={setDraft} said={said} setSaid={setSaid} />
      <ModelAnswer model={lesson.model_answer} fill={fill} profile={profile} ready={ready}
        extra={data.keyPoints.length > 0 && <ul className={styles.alts}>{data.keyPoints.map((k) => <li key={k.id}>{fill(k.text).en}</li>)}</ul>} />
      {data.followUps.length > 0 && (
        <div className={learn.card}>
          <h2 className={learn.h2}>Câu hỏi phụ</h2>
          {data.followUps.map((q) => <FollowUp key={q.id} q={q} fill={fill} />)}
        </div>
      )}
    </>
  );
}

function FollowUp({ q, fill }: { q: Data["followUps"][number]; fill: Fill }) {
  const [open, setOpen] = useState(false);
  const [vi, setVi] = useState(false);
  const scope = q.origin_scope;
  const prompt = fill(q.prompt, scope);
  return (
    <div className={learn.item}>
      <Bilingual text={prompt} vi={vi} speak />
      {prompt.vi && <p><button type="button" className={styles.toggle} onClick={() => setVi(!vi)}>{vi ? "Ẩn nghĩa" : "Xem nghĩa"}</button></p>}
      {q.model_answer?.text && (
        <>
          {open && <div className={styles.answer}><Bilingual text={fill(q.model_answer.text, scope)} speak /></div>}
          <p><button type="button" className={styles.toggle} onClick={() => setOpen(!open)}>{open ? "Che đáp án" : "Tôi đã thử, xem đáp án"}</button></p>
        </>
      )}
    </div>
  );
}

function Exercises({ items, fill, answers, setAnswer }: { items: Exercise[]; fill: Fill; answers: Answers; setAnswer: SetAnswer }) {
  return (
    <div className={learn.card}>
      <h2 className={learn.h2}>Bài tập</h2>
      <p className={learn.muted}>Tự luyện, không tính điểm.</p>
      {items.map((e) => <ExerciseItem key={e.id} e={e} fill={fill} saved={answers[e.id]} onChange={(a) => setAnswer(e.id, a)} />)}
    </div>
  );
}

/** Câu trả lời và kết quả lưu theo mã bài tập (đổi mức hay tải lại vẫn còn). */
function ExerciseItem({ e, fill, saved, onChange }: { e: Exercise; fill: Fill; saved?: Answers[string]; onChange: (a: Answers[string]) => void }) {
  const value = saved?.value ?? "";
  const result = saved?.checked ? checkExercise(e, value) : null;
  const setValue = (v: string) => onChange({ value: v, checked: false });
  const prompt = fill(e.prompt);
  const check = () => onChange({ value, checked: true });
  return (
    <div className={styles.ex}>
      {prompt.vi && <p className={learn.vi}>{prompt.vi}</p>}
      {prompt.en && <p className={learn.en}>{prompt.en}</p>}
      {e.type === "single_choice" ? (
        <div role="radiogroup" aria-label={prompt.vi ?? prompt.en ?? "Chọn đáp án"} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(e.options ?? []).map((o) => (
            <label key={o.id} className={styles.choice}>
              <input type="radio" name={e.id} value={o.id} checked={value === o.id} onChange={() => setValue(o.id)} />
              <span>{o.id}. {fill(o.text).en}</span>
            </label>
          ))}
          <p><button type="button" className={learn.secondary} disabled={!value} onClick={check}>Kiểm tra</button></p>
        </div>
      ) : (
        <div className={styles.exRow}>
          <input aria-label={`Đáp án: ${prompt.vi ?? prompt.en ?? ""}`} value={value} onChange={(ev) => setValue(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") check(); }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <button type="button" className={learn.secondary} disabled={!value.trim()} onClick={check}>Kiểm tra</button>
        </div>
      )}
      <div aria-live="polite">{result && (
        <>
          <p className={result.correct ? styles.right : styles.wrong}>{result.correct ? "Đúng" : "Chưa đúng"}</p>
          {(result.feedback?.vi || result.feedback?.en) && <p className={learn.vi}>{result.feedback?.vi ?? result.feedback?.en}</p>}
        </>
      )}</div>
    </div>
  );
}
