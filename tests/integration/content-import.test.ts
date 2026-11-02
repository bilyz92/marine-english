import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { ContentImportError, importContent, importDatasets, pgSql } from "@/worker/content-import";
import { errCode, pgAs } from "../helpers/pg";

type Fixture = { publication: { importable: boolean }; lessons: { id: string; question: { text: { vi: string } } }[] };
const fixture = () => JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8")) as Fixture;

async function withMigrator<T>(run: (c: Client) => Promise<T>): Promise<T> {
  const client = await pgAs("migrator");
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const q = (sql: string, params: unknown[] = []) => withMigrator(async (c) => (await c.query(sql, params)).rows);

describe("nhập nội dung", () => {
  it("tạo khóa draft, phiên bản, đúng thứ tự, 3 bài học thử, bài dùng chung một phiên bản", async () => {
    const result = await withMigrator((c) => importContent(c, fixture()));
    expect(result).toEqual({ courses: 2, newCourseVersions: 2, newLessonVersions: 5 });
    const courses = await q(`SELECT slug, status, price_vnd, current_version_id FROM courses ORDER BY slug`);
    expect(courses.map((c) => [c.slug, c.status, c.price_vnd])).toEqual([
      ["engine_cadet_dry_cargo", "draft", null],
      ["engine_cadet_tanker", "draft", null],
    ]);
    const rows = await q(
      `SELECT l.external_id, cvl.position, cvl.is_free_trial FROM courses c
       JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
       JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
       WHERE c.slug = 'engine_cadet_tanker' ORDER BY cvl.position`,
    );
    expect(rows.map((r) => [r.external_id, r.position, r.is_free_trial])).toEqual([
      ["A001", 1, true], ["A002", 2, true], ["A003-1", 3, true], ["T001", 4, false],
    ]);
    const [content] = await q(`SELECT lv.content FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'A001'`);
    expect(content.content.id).toBe("A001");
    expect(content.content.activities.length).toBeGreaterThan(0);
  });

  it("nhập lại y nguyên không tạo gì mới; sửa một bài → phiên bản mới cho mọi khóa chứa bài đó", async () => {
    await withMigrator((c) => importContent(c, fixture()));
    expect(await withMigrator((c) => importContent(c, fixture()))).toEqual({ courses: 2, newCourseVersions: 0, newLessonVersions: 0 });
    const before = await q(`SELECT slug, current_version_id FROM courses ORDER BY slug`);
    const changed = fixture();
    changed.lessons.find((l) => l.id === "A002")!.question.text.vi = "Câu hỏi đã sửa";
    expect(await withMigrator((c) => importContent(c, changed))).toEqual({ courses: 2, newCourseVersions: 2, newLessonVersions: 1 });
    const after = await q(`SELECT slug, current_version_id FROM courses ORDER BY slug`);
    expect(after[0].current_version_id).not.toBe(before[0].current_version_id);
    expect(after[1].current_version_id).not.toBe(before[1].current_version_id);
    expect((await q(`SELECT count(*)::int AS n FROM course_versions`))[0].n).toBe(4);
  });

  it("importable=false hoặc thiếu dữ liệu → từ chối, DB không đổi", async () => {
    const bad = fixture();
    bad.publication.importable = false;
    await expect(withMigrator((c) => importContent(c, bad))).rejects.toBeInstanceOf(ContentImportError);
    await expect(withMigrator((c) => importContent(c, { publication: { importable: true } }))).rejects.toBeInstanceOf(ContentImportError);
    expect((await q(`SELECT count(*)::int AS n FROM courses`))[0].n).toBe(0);
  });

  it("quyền DB: me_app không sửa phiên bản, không đổi slug; publish thiếu giá bị CHECK chặn", async () => {
    await withMigrator((c) => importContent(c, fixture()));
    const app = await pgAs("app");
    try {
      expect(await errCode(app, `UPDATE course_versions SET version = 9`)).not.toBeNull();
      expect(await errCode(app, `UPDATE courses SET slug = 'x'`)).toBe("42501");
      expect(await errCode(app, `UPDATE courses SET status = 'published'`)).toBe("23514");
      expect(await errCode(app, `UPDATE courses SET price_vnd = 199000, status = 'published'`)).toBeNull();
      expect(await errCode(app, `DELETE FROM lessons`)).toBe("42501");
    } finally {
      await app.end();
    }
  });

  it("tệp thật Engine Cadet v6: 3 khóa, 94 bài", async () => {
    const data = JSON.parse(readFileSync("docs/Engine_Cadet_Three_Levels_v6/Engine_Cadet_Learning_Data_v6.json", "utf8"));
    const result = await withMigrator((c) => importContent(c, data));
    expect(result).toEqual({ courses: 3, newCourseVersions: 3, newLessonVersions: 94 });
  }, 120_000);

  it("me_app nhập được trong giao dịch của người gọi (lần đầu và nhập lại), báo cáo từng khóa", async () => {
    const app = await pgAs("app");
    try {
      const run = async () => {
        await app.query("BEGIN");
        try {
          const report = await importDatasets(pgSql(app), [fixture()]);
          await app.query("COMMIT");
          return report;
        } catch (error) {
          await app.query("ROLLBACK");
          throw error;
        }
      };
      const first = await run();
      expect(first.newLessonVersions).toBe(5);
      const tanker = first.courses.find((c) => c.slug === "engine_cadet_tanker")!;
      expect(tanker).toMatchObject({ existed: false, status: "draft", lessons: 4, versionBefore: null, newVersion: true });
      expect(tanker.versionAfter).toBeTruthy();
      const again = await run();
      expect(again.newLessonVersions).toBe(0);
      expect(again.courses.find((c) => c.slug === "engine_cadet_tanker")).toMatchObject({ existed: true, newVersion: false, versionBefore: tanker.versionAfter, versionAfter: tanker.versionAfter });
    } finally {
      await app.end();
    }
  });

  it("người gọi ROLLBACK thì không còn gì (bộ nhập không tự COMMIT)", async () => {
    const app = await pgAs("app");
    try {
      await app.query("BEGIN");
      await importDatasets(pgSql(app), [fixture()]);
      await app.query("ROLLBACK");
    } finally {
      await app.end();
    }
    expect((await q(`SELECT count(*)::int AS n FROM lessons`))[0].n).toBe(0);
  });

  it("Oiler: câu phụ liên kết ở bài khác được chép vào linked_follow_up_questions", async () => {
    const data = JSON.parse(readFileSync("docs/Oiler_Bilingual_Three_Levels_v1/Oiler_Learning_Data_v1.json", "utf8"));
    const started = Date.now();
    const result = await withMigrator((c) => importContent(c, data));
    expect(result).toEqual({ courses: 3, newCourseVersions: 3, newLessonVersions: 120 });
    console.log(`nhập Oiler (120 bài): ${Date.now() - started} ms`);
    const [row] = await q(`SELECT lv.content FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'OL-A010-SMS'`);
    expect(row.content.linked_follow_up_questions.map((f: { id: string }) => f.id)).toEqual(["OL-A010.probe.1"]);
    expect(row.content.linked_follow_up_questions[0].prompt.en).toBeTruthy();
  }, 120_000);

  it("me_app: thêm được dòng nội dung mới nhưng không sửa/xóa phiên bản, không xóa bài", async () => {
    await withMigrator((c) => importContent(c, fixture()));
    const app = await pgAs("app");
    try {
      expect(await errCode(app, `INSERT INTO lessons (external_id) VALUES ('X-1')`)).toBeNull();
      expect(await errCode(app, `UPDATE courses SET title_vi = 'Tên mới'`)).toBeNull();
      expect(await errCode(app, `UPDATE lesson_versions SET version = 9`)).not.toBeNull();
      expect(await errCode(app, `DELETE FROM course_versions`)).not.toBeNull();
      expect(await errCode(app, `DELETE FROM lessons`)).toBe("42501");
      expect(await errCode(app, `UPDATE lessons SET external_id = 'Y'`)).toBe("42501");
    } finally {
      await app.end();
    }
  });
});
