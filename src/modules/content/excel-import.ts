// Khung bài giảng Excel (chủ chọn 09/11/2026, docs/superpowers/plans/2026-11-08-course-modules.md, Task 8):
// chủ tải khung về, điền mỗi dòng một bài, tải lên ở trang khóa; xem trước báo lỗi theo dòng, không lỗi mới thêm bài cuối khóa.
// Thứ tự cột phải khớp scripts/build-lesson-template.mjs.

import { sqlState, withTx, prisma, type Tx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { audit } from "@/modules/audit/audit";
import { authorize } from "@/modules/auth-admin/authorize";
import type { AdminCtx } from "@/modules/sessions/guards";
import { ContentConflict } from "./authoring";
import { applyFields, courseBySlug, courseVersionFor, FREE_TRIAL_LESSONS, freshLessonIds, lessonVersionFor, members, type CourseRow } from "./editor";
import { readSheetRows } from "./xlsx";

export const HEADERS = [
  "Module *",
  "Mã chủ đề",
  "Tên chủ đề",
  "Loại bài * (Hỏi–đáp / Tự luận)",
  "Câu hỏi / Đề bài (tiếng Anh) *",
  "Câu hỏi / Đề bài (tiếng Việt)",
  "Ý chính (mỗi dòng: tiếng Anh | tiếng Việt)",
  "Từ vựng (mỗi dòng: tiếng Anh | tiếng Việt)",
  "Đáp án mẫu (tiếng Anh)",
  "Đáp án mẫu (tiếng Việt)",
  "Câu hỏi phụ (mỗi dòng: tiếng Anh | tiếng Việt)",
];

export const MAX_LESSONS = 300;
const MAX_TEXT = 4000;
const LIMITS = { keyPoints: 10, vocabulary: 40, followUps: 20 } as const;

type Pair = { en: string; vi: string };
export type ExcelLesson = {
  row: number;
  module: string;
  topicId: string | null;
  topicTitle: string | null;
  lessonType: "qa" | "essay";
  questionEn: string;
  questionVi: string;
  keyPoints: Pair[];
  vocabulary: Pair[];
  modelAnswerEn: string;
  modelAnswerVi: string;
  followUps: Pair[];
};
export type RowError = { row: number; message: string };

const clean = (s: string | undefined) => (s ?? "").replace(/[ \t]+/g, " ").trim();
/** Tên module/chủ đề so khớp: bỏ khoảng trắng thừa, không phân biệt hoa thường. */
export const sameName = (s: string) => clean(s).normalize("NFC").toLocaleLowerCase("vi");

function lessonType(value: string): "qa" | "essay" | null {
  const v = sameName(value).replace(/[-–—\s]+/g, " ");
  if (v === "hỏi đáp") return "qa";
  if (v === "tự luận") return "essay";
  return null;
}

/** Trích ngắn chữ trong ô để báo lỗi (không chép lại cả ô dài). */
const short = (s: string) => { const t = clean(s); return t.length > 40 ? `${t.slice(0, 40)}…` : t; };

/** Mỗi dòng trong ô: "tiếng Anh | tiếng Việt" (không có | thì chỉ tiếng Anh). */
function pairs(value: string, label: string, max: number, errors: string[]): Pair[] {
  const out: Pair[] = [];
  for (const line of value.split("\n")) {
    if (!line.trim()) continue;
    const at = line.indexOf("|");
    const en = clean(at < 0 ? line : line.slice(0, at));
    const vi = at < 0 ? "" : clean(line.slice(at + 1));
    if (!en) errors.push(`${label}: dòng “${short(line)}” thiếu tiếng Anh.`);
    else out.push({ en, vi });
  }
  if (out.length > max) errors.push(`${label}: tối đa ${max} mục.`);
  if (out.some((p) => p.en.length > MAX_TEXT || p.vi.length > MAX_TEXT)) errors.push(`${label}: mỗi mục tối đa ${MAX_TEXT} ký tự.`);
  return out;
}

/** Kiểm từng dòng của trang "Bài học"; dòng trống bị bỏ. Số dòng trong lỗi là số dòng trên Excel (tiêu đề là dòng 1). */
export function parseLessonSheet(rows: string[][]): { lessons: ExcelLesson[]; errors: RowError[] } {
  const header = (rows[0] ?? []).slice(0, HEADERS.length).map(clean);
  if (header.length !== HEADERS.length || header.some((h, i) => h !== HEADERS[i])) {
    return { lessons: [], errors: [{ row: 1, message: "Không đúng khung mẫu: tải khung mới ở trang khóa và giữ nguyên tên, thứ tự cột." }] };
  }
  const filled = rows.map((cells, i) => ({ cells, row: i + 1 })).slice(1).filter(({ cells }) => cells.some((c) => c.trim()));
  if (filled.length > MAX_LESSONS) return { lessons: [], errors: [{ row: 1, message: `Tối đa ${MAX_LESSONS} bài mỗi tệp.` }] };

  const lessons: ExcelLesson[] = [];
  const errors: RowError[] = [];
  const topicSeen = new Map<string, { title: string; row: number }>();
  for (const { cells, row } of filled) {
    const problems: string[] = [];
    const [module, topicId, topicTitle, type, questionEn, questionVi, keyPoints, vocabulary, modelAnswerEn, modelAnswerVi, followUps] =
      HEADERS.map((_, i) => (i >= 6 ? (cells[i] ?? "").trim() : clean(cells[i])));
    if (!module) problems.push("Thiếu tên module.");
    else if (module.length > 120) problems.push("Tên module tối đa 120 ký tự.");
    const kind = lessonType(type!);
    if (!type) problems.push("Thiếu loại bài.");
    else if (!kind) problems.push(`Loại bài chưa hỗ trợ: “${short(type!)}” (chỉ nhận Hỏi–đáp hoặc Tự luận).`);
    if (!questionEn) problems.push("Thiếu câu hỏi / đề bài tiếng Anh.");
    if (kind === "essay" && !modelAnswerEn) problems.push("Bài tự luận cần đáp án mẫu tiếng Anh.");
    if (topicTitle && !topicId) problems.push("Có tên chủ đề nhưng thiếu mã chủ đề.");
    if (topicTitle!.length > 120) problems.push("Tên chủ đề tối đa 120 ký tự.");
    if (topicId && !/^[A-Z]{1,3}\d{1,3}$/.test(topicId)) problems.push(`Mã chủ đề “${short(topicId)}” phải là chữ hoa và số, ví dụ A1, B12.`);
    else if (topicId && topicTitle) {
      const seen = topicSeen.get(topicId);
      if (!seen) topicSeen.set(topicId, { title: topicTitle, row });
      else if (sameName(seen.title) !== sameName(topicTitle)) problems.push(`Mã chủ đề ${topicId} đã dùng với tên “${seen.title}” ở dòng ${seen.row}.`);
    }
    for (const [label, value] of [["Câu hỏi", questionEn], ["Câu hỏi tiếng Việt", questionVi], ["Đáp án mẫu", modelAnswerEn], ["Đáp án mẫu tiếng Việt", modelAnswerVi]] as const) {
      if (value!.length > MAX_TEXT) problems.push(`${label} tối đa ${MAX_TEXT} ký tự.`);
    }
    const lesson: ExcelLesson = {
      row, module: module!, topicId: topicId || null, topicTitle: topicTitle || null, lessonType: kind ?? "qa",
      questionEn: questionEn!, questionVi: questionVi!, modelAnswerEn: modelAnswerEn!, modelAnswerVi: modelAnswerVi!,
      keyPoints: pairs(keyPoints!, "Ý chính", LIMITS.keyPoints, problems),
      vocabulary: pairs(vocabulary!, "Từ vựng", LIMITS.vocabulary, problems),
      followUps: pairs(followUps!, "Câu hỏi phụ", LIMITS.followUps, problems),
    };
    for (const message of problems) errors.push({ row, message });
    if (!problems.length) lessons.push(lesson);
  }
  return { lessons, errors };
}

export const MAX_EXCEL_BYTES = 2 * 1024 * 1024;
// Tối đa 300 bài, mỗi bài vài câu lệnh: cho giao dịch thời gian rộng hơn sửa một bài (5 giây), vẫn không chờ khóa lâu.
const EXCEL_TX = { lockTimeoutMs: 3_000, retries: 0, txTimeoutMs: 60_000, statementTimeoutMs: 30_000 };
export const LESSON_SHEET = "Bài học";

type Topic = { id: string; titleVi: string; titleEn?: string };
export type ExcelPreview = { lessons: number; newModules: string[]; newTopics: string[]; errors: RowError[]; currentVersionId: string | null };

/** Đối chiếu bài trong tệp với module và chủ đề đang có của khóa: module mới, chủ đề mới, lỗi tên trùng / khác. */
async function plan(db: Tx | ReturnType<typeof prisma>, course: CourseRow, lessons: ExcelLesson[]) {
  const errors: RowError[] = [];
  const modules = await db.$queryRaw<{ id: string; title_vi: string }[]>`
    SELECT id::text AS id, title_vi FROM course_modules WHERE course_id = ${course.id}::uuid ORDER BY position`;
  const [{ topics }] = (await db.$queryRaw<{ topics: Topic[] }[]>`SELECT topics FROM courses WHERE id = ${course.id}::uuid`) as [{ topics: Topic[] }];
  const byName = new Map<string, string[]>();
  for (const m of modules) byName.set(sameName(m.title_vi), [...(byName.get(sameName(m.title_vi)) ?? []), m.id]);
  const newModules: string[] = [];
  const newTopics: Topic[] = [];
  const reported = new Set<string>();
  for (const l of lessons) {
    const key = sameName(l.module);
    const found = byName.get(key) ?? [];
    if (found.length > 1 && !reported.has(key)) {
      reported.add(key);
      errors.push({ row: l.row, message: `Có hai module cùng tên “${l.module}” trong khóa, đổi tên một cái trước.` });
    }
    if (!found.length && !newModules.some((n) => sameName(n) === key)) newModules.push(l.module);
    if (!l.topicId) continue;
    const known = topics.find((t) => t.id === l.topicId) ?? newTopics.find((t) => t.id === l.topicId);
    if (!known) {
      if (!l.topicTitle) errors.push({ row: l.row, message: `Mã chủ đề mới ${l.topicId} cần tên chủ đề.` });
      else newTopics.push({ id: l.topicId, titleVi: l.topicTitle, titleEn: "" });
    } else if (l.topicTitle && sameName(known.titleVi) !== sameName(l.topicTitle)) {
      errors.push({ row: l.row, message: `Mã chủ đề ${l.topicId} trong khóa có tên “${known.titleVi}”, khác tên trong tệp.` });
    }
  }
  return { errors, modules, topics, byName, newModules, newTopics };
}

/**
 * Tải lên file Excel: confirm=false chỉ xem trước (không ghi gì); confirm=true trong một giao dịch tạo module chưa có (theo thứ tự xuất
 * hiện; module đầu tiên của khóa nhận mọi bài đang có, như trên trang quản trị), thêm chủ đề mới vào cuối, thêm các bài vào cuối khóa
 * thành một phiên bản khóa mới, ghi nhật ký. Có lỗi thì không ghi gì. Cùng quy tắc stale / needs_confirm / busy như sửa bài trên web.
 */
export async function importExcel(
  ctx: AdminCtx, slug: string, bytes: Buffer, opts: { confirm: boolean; expectedVersionId: string | null; confirmLive: boolean },
): Promise<ExcelPreview> {
  await authorize(ctx, "content.edit", { action: "lessons_import_excel", resource: { type: "course", id: slug } });
  if (bytes.length > MAX_EXCEL_BYTES) throw new HttpError(413, "file_too_large");
  let rows: string[][];
  try {
    rows = readSheetRows(bytes, LESSON_SHEET);
  } catch (error) {
    if (error instanceof HttpError && error.message === "sheet_missing") {
      return { lessons: 0, newModules: [], newTopics: [], errors: [{ row: 1, message: `Không thấy trang “${LESSON_SHEET}”: dùng đúng khung mẫu.` }], currentVersionId: null };
    }
    throw error;
  }
  const parsed = parseLessonSheet(rows);
  const preview = async (db: Tx | ReturnType<typeof prisma>, course: CourseRow) => {
    const p = await plan(db, course, parsed.lessons);
    const errors = [...parsed.errors, ...p.errors].sort((a, b) => a.row - b.row);
    const view: ExcelPreview = { lessons: parsed.lessons.length, newModules: p.newModules, newTopics: p.newTopics.map((t) => t.id), errors, currentVersionId: course.current_version_id };
    return { p, view };
  };
  if (!opts.confirm || parsed.errors.length || !parsed.lessons.length) {
    const { view } = await preview(prisma(), await courseBySlug(prisma(), slug));
    if (!parsed.lessons.length && !view.errors.length) view.errors.push({ row: 2, message: "Tệp chưa có bài nào." });
    return view;
  }
  try {
    return await withTx(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext('content-import'))`;
      const course = await courseBySlug(tx, slug, true);
      if (course.current_version_id !== opts.expectedVersionId) throw new ContentConflict("stale");
      if (course.status === "published" && !opts.confirmLive) throw new ContentConflict("needs_confirm", [slug]);
      const { p, view } = await preview(tx, course);
      if (view.errors.length) return view;
      const list = await members(tx, course.current_version_id);

      // Module chưa có: tạo theo thứ tự trong tệp; khóa chưa có module thì bài đang có vào module đầu tiên.
      const moduleId = new Map<string, string>([...p.byName].map(([k, ids]) => [k, ids[0]!]));
      for (const [i, title] of p.newModules.entries()) {
        const [created] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO course_modules (course_id, title_vi, position) VALUES (${course.id}::uuid, ${title}, ${p.modules.length + i + 1}) RETURNING id::text AS id`;
        moduleId.set(sameName(title), created!.id);
        if (p.modules.length === 0 && i === 0) {
          for (const m of list) {
            await tx.$executeRaw`INSERT INTO course_lesson_modules (course_id, lesson_id, module_id)
              VALUES (${course.id}::uuid, ${m.lessonId}::uuid, ${created!.id}::uuid) ON CONFLICT (course_id, lesson_id) DO NOTHING`;
          }
        }
      }
      if (p.newTopics.length) {
        await tx.$executeRaw`UPDATE courses SET topics = ${JSON.stringify([...p.topics, ...p.newTopics])}::jsonb WHERE id = ${course.id}::uuid`;
      }

      const ids = await freshLessonIds(tx, slug, parsed.lessons.length, list.length + 1);
      const next = list.map(({ externalId, hash, lessonVersionId, position, isFreeTrial }) => ({ externalId, hash, lessonVersionId, position, isFreeTrial }));
      for (const [i, l] of parsed.lessons.entries()) {
        const id = ids[i]!;
        const base = { source_kind: "excel", ...(l.topicId ? { module_id: l.topicId } : {}) };
        const content = applyFields(base, id, l);
        const lv = await lessonVersionFor(tx, id, content);
        const position = next.length + 1;
        next.push({ externalId: id, hash: lv.hash, lessonVersionId: lv.id, position, isFreeTrial: position <= FREE_TRIAL_LESSONS });
        await tx.$executeRaw`
          INSERT INTO course_lesson_modules (course_id, lesson_id, module_id)
          SELECT ${course.id}::uuid, id, ${moduleId.get(sameName(l.module))!}::uuid FROM lessons WHERE external_id = ${id}
          ON CONFLICT (course_id, lesson_id) DO UPDATE SET module_id = EXCLUDED.module_id`;
      }
      const versionId = await courseVersionFor(tx, course.id, next, "excel");
      await tx.$executeRaw`UPDATE courses SET current_version_id = ${versionId}::uuid, updated_at = now() WHERE id = ${course.id}::uuid`;
      await audit(tx, {
        adminId: ctx.adminId, action: "lessons_import_excel", targetType: "course", targetId: slug,
        before: { courseVersion: course.current_version_id },
        after: { courseVersion: versionId, lessons: ids, newModules: p.newModules, newTopics: view.newTopics, live: course.status === "published" },
        result: "ok", ip: ctx.ip,
      });
      return { ...view, currentVersionId: versionId };
    }, EXCEL_TX);
  } catch (error) {
    if (sqlState(error) === "55P03") throw new ContentConflict("busy");
    throw error;
  }
}
