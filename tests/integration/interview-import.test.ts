import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { courseManifest, type Manifest } from "@/modules/learn/manifest";
import { GET as getLesson, PUT as putLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/route";
import { POST as importRoute } from "@/app/api/quan-tri/content/import/route";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { withSearchPath } from "../helpers/db";
import { makeXlsx } from "../helpers/xlsx";
import { workbook } from "../helpers/interview";

// Bộ luyện phỏng vấn Engine Cadet (docs/superpowers/plans/2026-11-25-engine-cadet-interview.md, Task 2–3).
// Dùng workbook nhỏ (2 câu): khóa tư vấn 'content-import' là khóa của cả DB, nhập cả 87 bài giữ khóa lâu làm tệp test khác chạy song song
// bị hết giờ chờ khóa. Tệp thật 87 câu được kiểm ở test đơn vị (đọc đủ) và tests/e2e-ui/interview.mjs (nhập qua trang quản trị).

const FILE = path.join(tmpdir(), `interview-small-${process.pid}.xlsx`);
writeFileSync(FILE, makeXlsx(workbook()));
const SLUG = "mea_cadet_interview";
const run = promisify(execFile);

/** Chạy CLI thật như `pnpm cli` (cùng cờ trong package.json), DB của tệp test này. */
async function cli(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const script = (JSON.parse(readFileSync("package.json", "utf8")) as { scripts: { cli: string } }).scripts.cli.split(/\s+/).slice(1);
  try {
    const r = await run("node", [...script, ...args], {
      env: { ...process.env, MIGRATOR_DATABASE_URL: withSearchPath(process.env.MIGRATOR_DATABASE_URL!, process.env.TEST_SCHEMA!) },
    });
    return { code: 0, out: r.stdout, err: r.stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout, err: e.stderr };
  }
}

const course = async () => (await sqlAsMigrator(`SELECT id::text AS id, status, price_vnd, topics, current_version_id::text AS v FROM courses WHERE slug = $1`, [SLUG])).rows[0];

describe("nhập bộ luyện phỏng vấn", () => {
  it("CLI: nhập tệp → khóa nháp, 2 bài học thử, chủ đề; nhập lại không có gì mới; tệp lỗi → mã thoát 1, in dòng lỗi", async () => {
    const first = await cli("content:import", FILE);
    expect(first.err).not.toMatch(/Error|at /);
    expect(first.code).toBe(0);
    expect(first.out).toContain("Đã nhập 1 khóa: 1 phiên bản khóa mới, 2 phiên bản bài mới.");
    const c = await course();
    expect([c.status, c.price_vnd]).toEqual(["draft", null]);
    expect(c.topics).toEqual([{ id: "T01", titleVi: "Giới thiệu", titleEn: "" }, { id: "T02", titleVi: "Động lực", titleEn: "" }]);
    const rows = (await sqlAsMigrator(
      `SELECT l.external_id, cvl.is_free_trial, lv.content ->> 'lesson_type' AS type FROM course_version_lessons cvl
       JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id JOIN lessons l ON l.id = lv.lesson_id
       WHERE cvl.course_version_id = $1::uuid ORDER BY cvl.position`, [c.v])).rows;
    expect(rows.map((r) => [r.external_id, r.is_free_trial])).toEqual([["EC-001", true], ["EC-002", true]]);
    expect(rows.every((r) => r.type === "interview")).toBe(true);

    const again = await cli("content:import", FILE);
    expect(again.code).toBe(0);
    expect(again.out).toContain("0 phiên bản khóa mới, 0 phiên bản bài mới");
    expect((await course()).v).toBe(c.v);

    const bad = path.join(tmpdir(), `interview-bad-${process.pid}.xlsx`);
    writeFileSync(bad, makeXlsx({ "Ngân hàng": [["Mã câu", "Chủ đề"], ["EC-001", "x"]] }));
    const failed = await cli("content:import", bad);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('Trang "Ngân hàng": thiếu cột');
    expect(failed.err).not.toMatch(/\n\s+at /);
  }, 60_000);

  it("trang /admin/noi-dung: xem trước rồi nhập; manifest học viên có loại bài interview; web không sửa được bài interview", async () => {
    const owner = await adminSess("owner");
    const bytes = makeXlsx(workbook());
    const upload = (apply: boolean, receipt?: string) =>
      importRoute(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/content/import?file=engine_cadet_interview_questions.xlsx${apply ? "&apply=1" : ""}`, {
        method: "POST",
        headers: {
          cookie: `__Host-me_admin=${owner.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": owner.csrf,
          "content-type": "application/octet-stream", "content-length": String(bytes.length), ...(receipt ? { "x-preview-receipt": receipt } : {}),
        },
        body: new Uint8Array(bytes),
      }));
    const preview = await upload(false);
    expect(preview.status).toBe(200);
    const view = (await preview.json()) as { receipt: string; courses: { slug: string; lessons: number; existed: boolean }[] };
    expect(view.courses).toEqual([expect.objectContaining({ slug: SLUG, lessons: 2, existed: false })]);
    expect(await course()).toBeUndefined();
    expect((await upload(true, view.receipt)).status).toBe(200);
    const c = await course();

    const learner = await testLearner();
    await sqlAsMigrator(`INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by) VALUES ($1, $2, 'grant', 'học nội bộ', $3)`, [learner.userId, c.id, owner.adminId]);
    const manifest = (await courseManifest({ ...learner, ip: "10.0.0.1" } as never, SLUG)) as Manifest;
    expect(manifest.lessons[0]).toMatchObject({ externalId: "EC-001", lessonType: "interview", topic: "T01", isFreeTrial: true });

    const lesson = await callAdmin(getLesson, owner, "GET", `/api/quan-tri/content/courses/${SLUG}/lessons/EC-002`, undefined, { slug: SLUG, externalId: "EC-002" });
    expect(lesson.status).toBe(200);
    const put = await callAdmin(putLesson, owner, "PUT", `/api/quan-tri/content/courses/${SLUG}/lessons/EC-002`, {
      expectedVersionId: c.v, questionEn: "Changed?", questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    }, { slug: SLUG, externalId: "EC-002" });
    expect(put.status).toBe(400);
    expect(await put.json()).toEqual({ error: "interview_readonly" });
    expect((await course()).v).toBe(c.v);
  }, 60_000);
});
