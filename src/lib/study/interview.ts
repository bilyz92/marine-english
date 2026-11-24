import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { InterviewLesson } from "@/modules/content/interview-workbook";
import { profileValue, type FieldDef, type Profile } from "./personalize";

// Hàm thuần cho bài luyện phỏng vấn 3 mức (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 4).
// Chữ hiển thị luôn nguyên văn; chuẩn hóa chỉ áp dụng cho chữ đưa vào giọng đọc.

export type { InterviewLesson };
export type Level = "L1" | "L2" | "L3";
export const INTERVIEW_LEVELS: { id: Level; label: string; who: string }[] = [
  { id: "L1", label: "Tập từ đầu", who: "Tiếng Anh yếu" },
  { id: "L2", label: "Luyện từng ý", who: "Tiếng Anh trung bình" },
  { id: "L3", label: "Đọc theo mẫu nâng cao", who: "Tiếng Anh khá" },
];
export const L1_STEPS = 5;

export const isInterview = (c: unknown): c is InterviewLesson => (c as { lesson_type?: unknown } | null)?.lesson_type === "interview";

/** Cách hỏi của lượt vào bài thứ `visits` (từ 1), xoay vòng; `shift` = số lần bấm "Cách hỏi khác" trong lượt này. */
export function variantIndex(count: number, visits: number, shift = 0): number {
  if (count <= 0) return 0;
  return (((Math.max(visits, 1) - 1 + shift) % count) + count) % count;
}

/** Thứ tự hai lựa chọn ở L1 (LEARN01: trộn vị trí): ổn định trong một lượt, đổi theo bài và lượt. */
export function correctFirst(lessonId: string, visits: number): boolean {
  let h = visits;
  for (const ch of lessonId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 2 === 0;
}

// ===== Chỗ trống {name}, [training] =====

export type Part = { kind: "text"; text: string } | { kind: "slot"; raw: string; placeholder: string; field: FieldDef | null; value: string | null };
type Personalization = NonNullable<InterviewLesson["personalization"]>;

/** Tách chữ thành đoạn thường và chỗ trống; chỗ trống có trường hồ sơ thì điền giá trị đúng ngôn ngữ (thiếu → null). */
export function fillSlots(text: string, ctx: { personalization?: Personalization; profile: Profile; lang: "en" | "vi" }): { parts: Part[]; missing: FieldDef[] } {
  const parts: Part[] = [];
  const missing: FieldDef[] = [];
  let last = 0;
  for (const m of text.matchAll(/\{([^{}]+)\}|\[([^\]]+)\]/g)) {
    if (m.index > last) parts.push({ kind: "text", text: text.slice(last, m.index) });
    const placeholder = (m[1] ?? m[2])!;
    const binding = ctx.personalization?.bindings.find((b) => b.placeholder === placeholder);
    const field = (binding && ctx.personalization?.fields.find((f) => f.key === binding.field)) || null;
    const value = field ? profileValue(ctx.profile, field.key, field.type === "localized_text" ? ctx.lang : undefined) || null : null;
    if (field && !value && !missing.some((f) => f.key === field.key)) missing.push(field as FieldDef);
    parts.push({ kind: "slot", raw: m[0], placeholder, field: field as FieldDef | null, value });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return { parts, missing };
}

const ROMAN: Record<string, string> = { I: "One", II: "Two", III: "Three", IV: "Four", V: "Five", VI: "Six" };

/**
 * Chữ đưa vào giọng đọc (DATA03): bỏ số thứ tự đầu dòng, mỗi dòng thành một câu, đọc ký hiệu theo nghĩa, bỏ chỗ trống chưa điền.
 * Không dùng cho chữ hiển thị.
 */
export function speechText(text: string): string {
  let t = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[.)]\s+/, "").trim())
    .filter(Boolean)
    .map((line) => (/[.!?:;,]$/.test(line) ? line : `${line}.`))
    .join(" ");
  t = t
    .replace(/\{[^{}]*\}|\[[^\]]*\]/g, " ")
    .replace(/\s*→\s*/g, ", then ")
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent")
    .replace(/\bppm\b/g, "p p m")
    .replace(/CO₂|\bCO2\b/g, "C O 2")
    .replace(/\bME-C\b/g, "M E C")
    .replace(/\bOWS\b/g, "O W S");
  if (/\bAnnex/.test(t)) {
    t = t
      .replace(/\bAnnex(es)?\s+(VI|IV|V|III|II|I)\b/g, (_, es: string | undefined, r: string) => `Annex${es ?? ""} ${ROMAN[r]}`)
      .replace(/(^|[;,.]\s*|\s)(VI|IV|V|III|II|I)(?=\s*:)/g, (_, before: string, r: string) => `${before}Annex ${ROMAN[r]}`);
  }
  return t
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(?:\s*[.,;:!?])+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[\s.,;:!?]+$/, "");
}

/** Chữ giọng mẫu đọc cho một đoạn đã tách chỗ trống: chỗ đã điền đọc giá trị, chỗ chưa điền bỏ qua. */
export function spokenFrom(parts: Part[]): { text: string; skipped: boolean } {
  const joined = parts.map((p) => (p.kind === "text" ? p.text : (p.value ?? p.raw))).join("");
  return { text: speechText(joined), skipped: parts.some((p) => p.kind === "slot" && !p.value) };
}

// ===== Bản thu và tiến độ =====

export type Target = { level: Level; id: string };
/** 12 ký tự đầu sha256 (hex) của chữ. */
export const hash12 = (s: string) => bytesToHex(sha256(new TextEncoder().encode(s))).slice(0, 12);

/** Khóa bản thu: bài, mức, đích và băm chữ đọc cuối cùng (đổi chữ hay đổi hồ sơ → khóa khác). */
export const recordingKey = (lessonId: string, t: Target, spoken: string) => `${lessonId}|${t.level}|${t.id}|${hash12(spoken)}`;

export type InterviewProgress = {
  contentHash?: string;
  level?: Level;
  visits?: number;
  /** Khóa bản thu đã từng thu (đích tính là "đã nói" khi khóa hiện tại của nó có ở đây). */
  spoken?: string[];
  L1?: { step?: number; understood?: boolean; hideEn?: boolean; hideVi?: boolean };
  L2?: { segment?: number; keywords?: boolean };
  L3?: { showText?: boolean };
  /** Đã gửi lesson_completed: giữ mãi, không gửi lại. */
  completed?: boolean;
};

/** Mở bài: tăng lượt; nội dung bài đổi thì giữ lượt, mức, đã xong và đặt lại bước, đoạn, đã nói. */
export function enterLesson(saved: InterviewProgress, contentHash: string): InterviewProgress {
  const visits = (saved.visits ?? 0) + 1;
  if (saved.contentHash && saved.contentHash !== contentHash) {
    return { contentHash, visits, ...(saved.level ? { level: saved.level } : {}), ...(saved.completed ? { completed: true } : {}) };
  }
  return { ...saved, contentHash, visits };
}

/** Dấu "đã thu khi đã ẩn tiếng Anh" của một khóa bản thu (đích L1). */
export const hiddenMark = (key: string) => `${key}#an-tieng-anh`;

/** Ghi nhận một lượt thu: thêm khóa (và dấu đã ẩn tiếng Anh nếu có) vào danh sách đã nói, không trùng. */
export function markSpoken(p: InterviewProgress, key: string, englishHidden: boolean): InterviewProgress {
  const spoken = new Set(p.spoken ?? []);
  spoken.add(key);
  if (englishHidden) spoken.add(hiddenMark(key));
  return { ...p, spoken: [...spoken] };
}

/** Đích của mức đã đạt chưa (Quyết định 8): L1 = hiểu câu hỏi + thu câu đầu khi đã ẩn tiếng Anh; L2 = thu cả đáp án cơ bản; L3 = thu đáp án nâng cao. */
export function targetReached(p: InterviewProgress, level: Level, keys: { first: string; basic: string; advanced: string }): boolean {
  const said = (k: string) => (p.spoken ?? []).includes(k);
  if (level === "L1") return !!p.L1?.understood && said(hiddenMark(keys.first));
  if (level === "L2") return said(keys.basic);
  return said(keys.advanced);
}
