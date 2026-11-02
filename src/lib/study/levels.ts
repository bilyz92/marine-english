import { pickAlternative, type Alternative } from "./alternatives";
import type { Exercise } from "./exercise";
import { personalize, type FieldDef, type Personalization, type Profile } from "./personalize";

// Dữ liệu cho từng mức của một bài, giải mã tham chiếu trong learning_material.levels (Engine Cadet, Oiler, Wiper).

export type LevelId = "foundation" | "developing" | "independent";
export const LEVELS: { id: LevelId; label: string; hint: string }[] = [
  { id: "foundation", label: "Mức 1 · Mới bắt đầu", hint: "Học từng câu nhỏ" },
  { id: "developing", label: "Mức 2 · Cơ bản", hint: "Trả lời theo 3 ý" },
  { id: "independent", label: "Mức 3 · Khá/Tốt", hint: "Tự trả lời, ít trợ giúp" },
];

type Text = { en?: string; vi?: string };
type Alt = Alternative;
export type Step = { id: string; order: number; question?: Text; short_answer?: Text; short_answer_alternatives?: Alt[] };
type FollowUp = { id: string; prompt?: Text; model_answer?: { text?: Text }; origin_scope?: string };
type Level = { id: string; micro_unit_ids?: string[]; exercise_ids?: string[]; required_point_ids?: string[]; task?: Text };

export type StudyLesson = {
  id: string;
  question?: { text?: Text; variants?: { id: string; text?: Text }[] };
  key_points?: { id: string; text?: Text }[];
  model_answer?: { text?: Text; alternatives?: Alt[] };
  follow_up_questions?: FollowUp[];
  linked_follow_up_questions?: FollowUp[];
  learning_material?: { levels?: Level[]; question_breakdown?: { units?: Step[] }; useful_phrases?: Text[] };
  exercises?: Exercise[];
  personalization?: Personalization;
  vocabulary?: ({ id?: string; text?: Text } & Text)[];
  recall_cards?: { id: string; front?: Text; back?: Text }[];
};

export const hasLevels = (l: StudyLesson) => (l.learning_material?.levels?.length ?? 0) > 0;

export function levelData(lesson: StudyLesson, id: LevelId) {
  const level = lesson.learning_material?.levels?.find((l) => l.id === id);
  const pick = <T extends { id: string }>(all: T[], ids: string[] | undefined) =>
    ids ? ids.map((x) => all.find((a) => a.id === x)).filter((a): a is T => !!a) : [];
  const units = lesson.learning_material?.question_breakdown?.units ?? [];
  const exercises = lesson.exercises ?? [];
  const keyPoints = lesson.key_points ?? [];
  return {
    task: level?.task,
    steps: id === "foundation" ? (level?.micro_unit_ids ? pick(units, level.micro_unit_ids) : units) : [],
    exercises: level?.exercise_ids ? pick(exercises, level.exercise_ids) : exercises.filter((e) => e.level_id === id),
    keyPoints: level?.required_point_ids ? pick(keyPoints, level.required_point_ids) : keyPoints,
    variants: lesson.question?.variants ?? [],
    followUps: [...(lesson.follow_up_questions ?? []), ...(lesson.linked_follow_up_questions ?? [])],
    phrases: lesson.learning_material?.useful_phrases ?? [],
  };
}

const isLevel = (v: unknown): v is LevelId => LEVELS.some((l) => l.id === v);

/** Mức đã lưu của bài, rồi mức ưu tiên của tài khoản, cuối cùng Mức 1. */
export function defaultLevel(saved: { lesson: unknown; account: unknown }): LevelId {
  if (isLevel(saved.lesson)) return saved.lesson;
  if (isLevel(saved.account)) return saved.account;
  return "foundation";
}

/**
 * Trường hồ sơ mà phần đang hiện (theo mức và bước) cần nhưng chưa có: chỗ trống trong chữ đang hiện, và trường điều kiện
 * của đáp án thay thế đang hiện. Không hỏi trường của phần chưa mở.
 */
export function missingFor(lesson: StudyLesson, level: LevelId, step: number, profile: Profile): FieldDef[] {
  const p = lesson.personalization;
  if (!p) return [];
  const data = levelData(lesson, level);
  const own = lesson.id;
  const texts: { text?: Text; scope: string }[] = [];
  const keys = new Set<string>();
  const add = (text?: Text, scope = own) => texts.push({ text, scope });
  const addAlt = (base: Text | undefined, alts: Alt[] | undefined) => {
    const r = pickAlternative(base, alts, profile);
    add(r.text);
    for (const c of r.choices) add(c.text);
    for (const f of r.unsetFields) keys.add(f);
  };
  add(lesson.question?.text);
  if (level === "foundation") {
    const s = data.steps[step];
    if (s) {
      add(s.question);
      addAlt(s.short_answer, s.short_answer_alternatives);
    } else for (const e of data.exercises) [e.prompt, ...(e.options ?? []).map((o) => o.text)].forEach((t) => add(t));
  } else {
    for (const k of data.keyPoints) add(k.text);
    addAlt(lesson.model_answer?.text, lesson.model_answer?.alternatives);
    if (level === "developing") for (const e of data.exercises) [e.prompt, ...(e.options ?? []).map((o) => o.text)].forEach((t) => add(t));
    if (level === "independent") {
      for (const v of data.variants) add(v.text);
      for (const f of data.followUps) { add(f.prompt, f.origin_scope ?? own); add(f.model_answer?.text, f.origin_scope ?? own); }
    }
  }
  for (const { text, scope } of texts) {
    for (const lang of ["en", "vi"] as const) {
      const t = text?.[lang];
      if (t) for (const k of personalize(t, { bindings: p.bindings, scope, profile, lang }).missing) keys.add(k);
    }
  }
  return p.fields.filter((f) => keys.has(f.key));
}
