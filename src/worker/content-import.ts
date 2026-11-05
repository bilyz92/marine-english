// Nhập dữ liệu học (JSON: Engine Cadet, Oiler, Wiper, bộ dựng từ Word) thành khóa/bài có phiên bản.
// Bài trùng nội dung (hash) dùng lại phiên bản cũ; khóa có phiên bản mới khi danh sách (bài, hash) đổi. Không tự mở bán.
// Không tự mở/đóng giao dịch: người gọi (CLI, route quản trị) nắm giao dịch, kể cả việc xem trước rồi ROLLBACK.
// Chỉ dùng pg/kiểu thuần để CLI chạy thẳng bằng Node.
import { createHash } from "node:crypto";
import type pg from "pg";

export class ContentImportError extends Error {}

const FREE_TRIAL_LESSONS = 3;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RawCourse = { id: string; title: { en: string; vi: string }; lesson_ids: string[] };
type RawLesson = { id: string; [key: string]: Json };
type RawActivity = { lesson_id: string; order: number; [key: string]: Json };
type FollowUp = { id: string; [key: string]: Json };

/** Giao diện tối thiểu để chạy SQL trong giao dịch của người gọi (pg.Client, hoặc giao dịch Prisma ở web). */
export type Sql = { query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> };

export const pgSql = (client: pg.Client | pg.PoolClient): Sql => ({
  query: async <T>(text: string, params: unknown[] = []) => (await client.query(text, params)).rows as T[],
});

export type CourseReport = {
  slug: string;
  titleVi: string;
  lessons: number;
  existed: boolean;
  status: string;
  versionBefore: string | null;
  versionAfter: string;
  newVersion: boolean;
  /** Khóa có sẵn mà tên đổi theo gói. */
  titleChanged: boolean;
  /** Tên lúc trước khi nhập (biên nhận xem trước gắn cả tên, để phát hiện tên bị đổi chen giữa). */
  titleBefore: { vi: string; en: string } | null;
};
export type ImportReport = { courses: CourseReport[]; newCourseVersions: number; newLessonVersions: number };

/** JSON với khóa sắp xếp, để hash không phụ thuộc thứ tự khóa. */
export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Hash nội dung bài (dùng chung cho bộ nhập và trình soạn bài trên web). */
export const contentHash = (content: unknown) => sha256(canonical(content as Json));

type Binding = { binding_scope?: string; placeholder: string; profile_field: string };
type FieldDef = { key: string; label_vi?: string; label?: { vi?: string; en?: string }; type?: string; values?: string[]; min?: number; max?: number };
type Parsed = {
  contentVersion: string;
  courses: RawCourse[];
  lessons: RawLesson[];
  activities: RawActivity[];
  exercises: { lesson_id: string; [key: string]: Json }[];
  bindings: Binding[];
  fields: FieldDef[];
  topics: Topic[];
};

/** Chủ đề của học liệu (catalog.modules), ví dụ A1 "A1 Học vấn và mục tiêu nghề nghiệp". */
type Topic = { id: string; title: { vi: string; en: string }; lesson_ids: string[] };

function parse(data: unknown): Parsed {
  const d = data as {
    publication?: { importable?: unknown }; content_version?: unknown; courses?: unknown; lessons?: unknown; activities?: unknown;
    learning_exercises?: unknown; placeholder_bindings?: unknown; profile_contract?: { fields?: unknown }; catalog?: { modules?: unknown };
  };
  if (d?.publication?.importable !== true) throw new ContentImportError("Dữ liệu chưa được đánh dấu nhập được (publication.importable)");
  if (!Array.isArray(d.courses) || !Array.isArray(d.lessons)) throw new ContentImportError("Thiếu courses hoặc lessons");
  const courses = d.courses as RawCourse[];
  const lessons = d.lessons as RawLesson[];
  for (const c of courses) {
    if (typeof c?.id !== "string" || !Array.isArray(c.lesson_ids) || typeof c.title?.vi !== "string" || typeof c.title?.en !== "string") {
      throw new ContentImportError("Khóa học sai cấu trúc");
    }
  }
  if (lessons.some((l) => typeof l?.id !== "string")) throw new ContentImportError("Bài học sai cấu trúc");
  return {
    contentVersion: String(d.content_version ?? ""),
    courses,
    lessons,
    activities: Array.isArray(d.activities) ? (d.activities as RawActivity[]) : [],
    exercises: Array.isArray(d.learning_exercises) ? (d.learning_exercises as Parsed["exercises"]) : [],
    bindings: Array.isArray(d.placeholder_bindings) ? (d.placeholder_bindings as Binding[]) : [],
    fields: Array.isArray(d.profile_contract?.fields) ? (d.profile_contract!.fields as FieldDef[]) : [],
    topics: Array.isArray(d.catalog?.modules)
      ? (d.catalog!.modules as Topic[]).filter((t) => typeof t?.id === "string" && typeof t.title?.vi === "string" && Array.isArray(t.lesson_ids))
      : [],
  };
}

/** Chủ đề có bài trong khóa, theo thứ tự học liệu; bỏ mã chủ đề ở đầu tên ("A1 Học vấn…" → "Học vấn…"). */
export function courseTopics(topics: Topic[], lessonIds: string[]): { id: string; titleVi: string; titleEn: string }[] {
  const inCourse = new Set(lessonIds);
  const strip = (id: string, title: string) => (title.startsWith(`${id} `) ? title.slice(id.length + 1) : title).trim();
  return topics
    .filter((t) => t.lesson_ids.some((id) => inCourse.has(id)))
    .map((t) => ({ id: t.id, titleVi: strip(t.id, t.title.vi), titleEn: strip(t.id, t.title.en ?? "") }));
}

/** Mọi nhãn ngoặc [..] trong chữ của một giá trị JSON. */
function placeholdersIn(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") for (const m of value.matchAll(/\[([^\]]+)\]/g)) out.add(m[1]!);
  else if (Array.isArray(value)) for (const v of value) placeholdersIn(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) placeholdersIn(v, out);
  return out;
}

/** Trường hồ sơ dùng trong điều kiện của đáp án thay thế ({profile_field, equals} hoặc {all: [...]}). */
function conditionFields(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) conditionFields(v, out);
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.profile_field === "string" && "equals" in o) out.add(o.profile_field);
    for (const v of Object.values(o)) conditionFields(v, out);
  }
  return out;
}

/**
 * Giao diện 3 mức (docs/superpowers/plans/2026-11-03-three-level-study.md): gắn vào bài các bài tập của bài và bảng
 * chỗ trống → trường hồ sơ cho đúng các nhãn ngoặc có trong bài. Bộ có binding_scope (Oiler, Wiper) chỉ lấy binding
 * của chính bài hoặc của bài gốc chứa câu phụ được liên kết vào. Bộ không có các phần này thì bài giữ nguyên.
 */
function withStudyData(lesson: RawLesson, p: Parsed, followUpOrigin: Map<string, string>): RawLesson {
  const exercises = p.exercises.filter((e) => e.lesson_id === lesson.id);
  const used = placeholdersIn({ ...lesson, exercises });
  const scopes = new Set([lesson.id, ...((lesson.linked_follow_up_questions as FollowUp[] | undefined) ?? []).map((f) => followUpOrigin.get(f.id)).filter(Boolean) as string[]]);
  const bindings = p.bindings
    .filter((b) => used.has(b.placeholder) && (!b.binding_scope || scopes.has(b.binding_scope)))
    .map((b) => (b.binding_scope ? { scope: b.binding_scope, placeholder: b.placeholder, field: b.profile_field } : { placeholder: b.placeholder, field: b.profile_field }));
  const keys = new Set([...bindings.map((b) => b.field), ...conditionFields(lesson)]);
  const fields = p.fields
    .filter((f) => keys.has(f.key))
    .map((f) => ({
      key: f.key,
      label: { vi: f.label_vi ?? f.label?.vi ?? f.key, ...(f.label?.en ? { en: f.label.en } : {}) },
      type: f.type ?? "string",
      ...(Array.isArray(f.values) ? { values: f.values } : {}),
      ...(typeof f.min === "number" ? { min: f.min } : {}),
      ...(typeof f.max === "number" ? { max: f.max } : {}),
    }));
  const extra: Record<string, Json> = {};
  if (exercises.length) extra.exercises = exercises;
  if (bindings.length || fields.length) extra.personalization = { bindings, fields } as unknown as Json;
  return Object.keys(extra).length ? { ...lesson, ...extra } : lesson;
}

/** Câu phụ mà bài chỉ tham chiếu (related_follow_up_ids) nhưng lưu ở bài khác: chép vào linked_follow_up_questions. */
function withLinkedFollowUps(lessons: RawLesson[]): RawLesson[] {
  // Câu phụ kèm bài gốc (origin_scope): chỗ trống trong câu phụ điền theo phạm vi của bài gốc, không theo bài đang mở.
  const byId = new Map<string, FollowUp>();
  for (const l of lessons) for (const f of (l.follow_up_questions as FollowUp[] | undefined) ?? []) byId.set(f.id, { ...f, origin_scope: l.id });
  return lessons.map((lesson) => {
    const related = lesson.related_follow_up_ids;
    if (!Array.isArray(related) || !related.length) return lesson;
    const own = new Set(((lesson.follow_up_questions as FollowUp[] | undefined) ?? []).map((f) => f.id));
    const linked = (related as string[]).filter((id) => !own.has(id)).map((id) => {
      const found = byId.get(id);
      if (!found) throw new ContentImportError(`Bài ${lesson.id} trỏ tới câu phụ không có: ${id}`);
      return found;
    });
    return linked.length ? { ...lesson, linked_follow_up_questions: linked } : lesson;
  });
}

/** Nhập một hoặc nhiều bộ dữ liệu trong giao dịch của người gọi. */
export async function importDatasets(sql: Sql, datasets: unknown[]): Promise<ImportReport> {
  const parsed = datasets.map(parse);
  const report: ImportReport = { courses: [], newCourseVersions: 0, newLessonVersions: 0 };
  await sql.query(`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext('content-import'))`);
  for (const p of parsed) {
    const { contentVersion, courses, lessons, activities } = p;
    const followUpOrigin = new Map<string, string>();
    for (const l of lessons) for (const f of (l.follow_up_questions as FollowUp[] | undefined) ?? []) followUpOrigin.set(f.id, l.id);
    const lessonVersion = new Map<string, { id: string; hash: string }>();
    for (const linked of withLinkedFollowUps(lessons)) {
      const lesson = withStudyData(linked, p, followUpOrigin);
      const own = activities.filter((a) => a.lesson_id === lesson.id).sort((a, b) => a.order - b.order);
      const content: Json = { ...lesson, activities: own };
      const hash = contentHash(content);
      await sql.query(`INSERT INTO lessons (external_id) VALUES ($1) ON CONFLICT (external_id) DO NOTHING`, [lesson.id]);
      const [l] = await sql.query<{ id: string }>(`SELECT id::text AS id FROM lessons WHERE external_id = $1`, [lesson.id]);
      const [existing] = await sql.query<{ id: string }>(
        `SELECT id::text AS id FROM lesson_versions WHERE lesson_id = $1::uuid AND content_hash = $2`,
        [l!.id, hash],
      );
      let id = existing?.id;
      if (!id) {
        const [created] = await sql.query<{ id: string }>(
          `INSERT INTO lesson_versions (lesson_id, version, content, content_hash)
           VALUES ($1::uuid, (SELECT coalesce(max(version), 0) + 1 FROM lesson_versions WHERE lesson_id = $1::uuid), $2::jsonb, $3) RETURNING id::text AS id`,
          [l!.id, JSON.stringify(content), hash],
        );
        id = created!.id;
        report.newLessonVersions += 1;
      }
      // Ghi âm và tệp gắn với bài (chủ tải trên web) đi theo bài: chép từ phiên bản mà chính các khóa trong bộ dữ liệu này
      // đang dùng (không lấy từ khóa khác), kể cả khi dùng lại một phiên bản cũ cùng nội dung. Chạy trước vòng đổi phiên bản khóa.
      await sql.query(
        `INSERT INTO lesson_version_assets (lesson_version_id, media_asset_id, role)
         SELECT DISTINCT $1::uuid, lva.media_asset_id, lva.role FROM courses c
         JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
         JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id AND lv.lesson_id = $2::uuid AND lv.id <> $1::uuid
         JOIN lesson_version_assets lva ON lva.lesson_version_id = lv.id
         WHERE c.slug = ANY($3::text[])
         ON CONFLICT DO NOTHING`,
        [id, l!.id, courses.filter((c) => c.lesson_ids.includes(lesson.id)).map((c) => c.id)],
      );
      lessonVersion.set(lesson.id, { id, hash });
    }

    for (const course of courses) {
      const members = course.lesson_ids.map((externalId) => {
        const v = lessonVersion.get(externalId);
        if (!v) throw new ContentImportError(`Khóa ${course.id} trỏ tới bài không có: ${externalId}`);
        return { externalId, ...v };
      });
      const sourceHash = sha256(JSON.stringify(members.map((m) => [m.externalId, m.hash])));
      const [before] = await sql.query<{ id: string; status: string; current_version_id: string | null; title_vi: string; title_en: string }>(
        `SELECT id::text AS id, status, current_version_id::text AS current_version_id, title_vi, title_en FROM courses WHERE slug = $1 FOR UPDATE`,
        [course.id],
      );
      const [c] = await sql.query<{ id: string; status: string }>(
        `INSERT INTO courses (slug, title_vi, title_en, topics) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (slug) DO UPDATE SET title_vi = EXCLUDED.title_vi, title_en = EXCLUDED.title_en, topics = EXCLUDED.topics, updated_at = now()
         RETURNING id::text AS id, status`,
        [course.id, course.title.vi, course.title.en, JSON.stringify(courseTopics(p.topics, course.lesson_ids))],
      );
      const [existing] = await sql.query<{ id: string }>(
        `SELECT id::text AS id FROM course_versions WHERE course_id = $1::uuid AND source_hash = $2`,
        [c!.id, sourceHash],
      );
      let versionId = existing?.id;
      if (!versionId) {
        const [created] = await sql.query<{ id: string }>(
          `INSERT INTO course_versions (course_id, version, content_version, source_hash)
           VALUES ($1::uuid, (SELECT coalesce(max(version), 0) + 1 FROM course_versions WHERE course_id = $1::uuid), $2, $3) RETURNING id::text AS id`,
          [c!.id, contentVersion, sourceHash],
        );
        versionId = created!.id;
        report.newCourseVersions += 1;
        for (const [i, m] of members.entries()) {
          await sql.query(
            `INSERT INTO course_version_lessons (course_version_id, lesson_version_id, position, is_free_trial) VALUES ($1::uuid, $2::uuid, $3::int, $4::boolean)`,
            [versionId, m.id, i + 1, i < FREE_TRIAL_LESSONS],
          );
        }
      }
      await sql.query(`UPDATE courses SET current_version_id = $2::uuid, updated_at = now() WHERE id = $1::uuid AND current_version_id IS DISTINCT FROM $2::uuid`, [c!.id, versionId]);
      report.courses.push({
        slug: course.id,
        titleVi: course.title.vi,
        lessons: members.length,
        existed: !!before,
        titleChanged: !!before && (before.title_vi !== course.title.vi || before.title_en !== course.title.en),
        titleBefore: before ? { vi: before.title_vi, en: before.title_en } : null,
        status: c!.status,
        versionBefore: before?.current_version_id ?? null,
        versionAfter: versionId,
        newVersion: (before?.current_version_id ?? null) !== versionId,
      });
    }
  }
  return report;
}

/** CLI và test: nhập một bộ trong giao dịch riêng. */
export async function importContent(
  client: pg.Client,
  data: unknown,
): Promise<{ courses: number; newCourseVersions: number; newLessonVersions: number }> {
  await client.query("BEGIN");
  try {
    const report = await importDatasets(pgSql(client), [data]);
    await client.query("COMMIT");
    return { courses: report.courses.length, newCourseVersions: report.newCourseVersions, newLessonVersions: report.newLessonVersions };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
