// Nhập dữ liệu học Engine Cadet (JSON) thành khóa/bài có phiên bản. Chỉ dùng pg để CLI chạy thẳng bằng Node.
// Bài trùng nội dung (hash) dùng lại phiên bản cũ; khóa có phiên bản mới khi danh sách (bài, hash) đổi. Không tự mở bán.
import { createHash } from "node:crypto";
import type pg from "pg";

export class ContentImportError extends Error {}

const FREE_TRIAL_LESSONS = 3;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RawCourse = { id: string; title: { en: string; vi: string }; lesson_ids: string[] };
type RawLesson = { id: string; [key: string]: Json };
type RawActivity = { lesson_id: string; order: number; [key: string]: Json };

/** JSON với khóa sắp xếp, để hash không phụ thuộc thứ tự khóa. */
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

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

export async function importContent(
  client: pg.Client,
  data: unknown,
): Promise<{ courses: number; newCourseVersions: number; newLessonVersions: number }> {
  const { contentVersion, courses, lessons, activities } = parse(data);
  let newCourseVersions = 0;
  let newLessonVersions = 0;
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('content-import'))`);
    const lessonVersion = new Map<string, { id: string; hash: string }>();
    for (const lesson of lessons) {
      const own = activities.filter((a) => a.lesson_id === lesson.id).sort((a, b) => a.order - b.order);
      const content: Json = { ...lesson, activities: own };
      const hash = sha256(canonical(content));
      const { rows: [l] } = await client.query<{ id: string }>(
        `INSERT INTO lessons (external_id) VALUES ($1)
         ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id RETURNING id`,
        [lesson.id],
      );
      const { rows: [existing] } = await client.query<{ id: string }>(
        `SELECT id FROM lesson_versions WHERE lesson_id = $1 AND content_hash = $2`,
        [l!.id, hash],
      );
      let id = existing?.id;
      if (!id) {
        const { rows: [created] } = await client.query<{ id: string }>(
          `INSERT INTO lesson_versions (lesson_id, version, content, content_hash)
           VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM lesson_versions WHERE lesson_id = $1), $2, $3) RETURNING id`,
          [l!.id, JSON.stringify(content), hash],
        );
        id = created!.id;
        newLessonVersions += 1;
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
      const { rows: [c] } = await client.query<{ id: string }>(
        `INSERT INTO courses (slug, title_vi, title_en) VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET title_vi = EXCLUDED.title_vi, title_en = EXCLUDED.title_en, updated_at = now()
         RETURNING id`,
        [course.id, course.title.vi, course.title.en],
      );
      const { rows: [existing] } = await client.query<{ id: string }>(
        `SELECT id FROM course_versions WHERE course_id = $1 AND source_hash = $2`,
        [c!.id, sourceHash],
      );
      let versionId = existing?.id;
      if (!versionId) {
        const { rows: [created] } = await client.query<{ id: string }>(
          `INSERT INTO course_versions (course_id, version, content_version, source_hash)
           VALUES ($1, (SELECT coalesce(max(version), 0) + 1 FROM course_versions WHERE course_id = $1), $2, $3) RETURNING id`,
          [c!.id, contentVersion, sourceHash],
        );
        versionId = created!.id;
        newCourseVersions += 1;
        for (const [i, m] of members.entries()) {
          await client.query(
            `INSERT INTO course_version_lessons (course_version_id, lesson_version_id, position, is_free_trial) VALUES ($1, $2, $3, $4)`,
            [versionId, m.id, i + 1, i < FREE_TRIAL_LESSONS],
          );
        }
      }
      await client.query(`UPDATE courses SET current_version_id = $2, updated_at = now() WHERE id = $1 AND current_version_id IS DISTINCT FROM $2`, [c!.id, versionId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return { courses: courses.length, newCourseVersions, newLessonVersions };
}
