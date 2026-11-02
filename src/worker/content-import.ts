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

function parse(data: unknown): { contentVersion: string; courses: RawCourse[]; lessons: RawLesson[]; activities: RawActivity[] } {
  const d = data as { publication?: { importable?: unknown }; content_version?: unknown; courses?: unknown; lessons?: unknown; activities?: unknown };
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
  };
}

/** Câu phụ mà bài chỉ tham chiếu (related_follow_up_ids) nhưng lưu ở bài khác: chép vào linked_follow_up_questions. */
function withLinkedFollowUps(lessons: RawLesson[]): RawLesson[] {
  const byId = new Map<string, FollowUp>();
  for (const l of lessons) for (const f of (l.follow_up_questions as FollowUp[] | undefined) ?? []) byId.set(f.id, f);
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
  for (const { contentVersion, courses, lessons, activities } of parsed) {
    const lessonVersion = new Map<string, { id: string; hash: string }>();
    for (const lesson of withLinkedFollowUps(lessons)) {
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
        `INSERT INTO courses (slug, title_vi, title_en) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET title_vi = EXCLUDED.title_vi, title_en = EXCLUDED.title_en, updated_at = now()
         RETURNING id::text AS id, status`,
        [course.id, course.title.vi, course.title.en],
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
