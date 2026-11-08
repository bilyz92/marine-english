import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POST as createModuleRoute } from "@/app/api/quan-tri/content/courses/[slug]/modules/route";
import { POST as excelRoute } from "@/app/api/quan-tri/content/courses/[slug]/excel/route";
import { GET as templateRoute } from "@/app/api/quan-tri/content/template/route";
import { HEADERS } from "@/modules/content/excel-import";
import { importContent } from "@/worker/content-import";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";
import { makeXlsx } from "../helpers/xlsx";

// Khung bài giảng Excel (docs/superpowers/plans/2026-11-08-course-modules.md, Task 8).

const T = "engine_cadet_tanker";
const TEMPLATE = readFileSync("src/assets/khung-bai-giang-mau.xlsx");
type Preview = { lessons: number; newModules: string[]; newTopics: string[]; errors: { row: number; message: string }[]; currentVersionId: string | null; error?: string };

function upload(s: AdminSess | null, bytes: Buffer, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  const req = new Request(`${process.env.APP_ORIGIN}/api/quan-tri/content/courses/${T}/excel${qs ? `?${qs}` : ""}`, {
    method: "POST",
    headers: {
      origin: process.env.APP_ORIGIN!, "content-type": "application/octet-stream",
      ...(s ? { cookie: `__Host-me_admin=${s.token}`, "x-csrf-token": s.csrf } : {}),
    },
    body: new Uint8Array(bytes),
  });
  return excelRoute(req, { params: Promise.resolve({ slug: T }) });
}
const currentVersion = async () => (await sqlAsMigrator(`SELECT current_version_id::text AS v FROM courses WHERE slug = $1`, [T])).rows[0]!.v as string;
const confirm = async (s: AdminSess, bytes: Buffer) => upload(s, bytes, { confirm: "1", expectedVersionId: await currentVersion() });
const lessonsOf = async () => (await sqlAsMigrator(
  `SELECT l.external_id, cvl.is_free_trial, lv.content ->> 'source_kind' AS kind, lv.content ->> 'lesson_type' AS type, lv.content ->> 'module_id' AS topic, m.title_vi AS module
   FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id JOIN lesson_versions lv ON lv.id = cvl.lesson_version_id
   JOIN lessons l ON l.id = lv.lesson_id
   LEFT JOIN course_lesson_modules clm ON clm.course_id = c.id AND clm.lesson_id = l.id LEFT JOIN course_modules m ON m.id = clm.module_id
   WHERE c.slug = $1 ORDER BY cvl.position`, [T])).rows as { external_id: string; is_free_trial: boolean; kind: string | null; type: string | null; topic: string | null; module: string | null }[];
const row = (module: string, question: string, over: Partial<Record<number, string>> = {}) => {
  const r = [module, "", "", "Hỏi–đáp", question, "", "", "", "", "", ""];
  for (const [i, v] of Object.entries(over)) r[Number(i)] = v!;
  return r;
};

describe("tải lên khung bài giảng Excel", () => {
  it("xem trước không ghi gì", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const before = await currentVersion();
    const res = await upload(owner, TEMPLATE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lessons: 2, newModules: ["Kinh nghiệm phỏng vấn", "Kinh nghiệm vận hành sửa chữa"], newTopics: ["A4"], errors: [], currentVersionId: before,
    });
    expect(await currentVersion()).toBe(before);
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM course_modules`)).rows[0].n).toBe(0);
  });

  it("xác nhận: thêm 2 bài cuối khóa, tạo module mới (module đầu nhận bài cũ), thêm chủ đề mới, nhật ký", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await confirm(owner, TEMPLATE);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Preview;
    expect(body.errors).toEqual([]);
    expect(body.currentVersionId).toBe(await currentVersion());
    const lessons = await lessonsOf();
    expect(lessons.map((l) => [l.external_id, l.kind, l.type, l.topic, l.module])).toEqual([
      ["A001", null, null, "A1", "Kinh nghiệm phỏng vấn"],
      ["A002", null, null, "A1", "Kinh nghiệm phỏng vấn"],
      ["A003-1", null, null, "A1", "Kinh nghiệm phỏng vấn"],
      ["T001", null, null, "B1", "Kinh nghiệm phỏng vấn"],
      [`${T}-b5`, "excel", null, "A1", "Kinh nghiệm phỏng vấn"],
      [`${T}-b6`, "excel", "essay", "A4", "Kinh nghiệm vận hành sửa chữa"],
    ]);
    expect(lessons.filter((l) => l.is_free_trial)).toHaveLength(3);
    const { topics } = (await sqlAsMigrator(`SELECT topics FROM courses WHERE slug = $1`, [T])).rows[0] as { topics: { id: string; titleVi: string }[] };
    expect(topics.map((t) => t.id)).toEqual(["A1", "B1", "A4"]);
    expect(topics.at(-1)!.titleVi).toBe("Động cơ diesel và hệ động lực chính");
    const logs = (await sqlAsMigrator(`SELECT after FROM admin_audit_log WHERE action = 'lessons_import_excel' AND result = 'ok'`)).rows as { after: { lessons: string[]; newModules: string[] } }[];
    expect(logs).toHaveLength(1);
    expect(logs[0]!.after).toMatchObject({ lessons: [`${T}-b5`, `${T}-b6`], newModules: ["Kinh nghiệm phỏng vấn", "Kinh nghiệm vận hành sửa chữa"] });
  });

  it("có lỗi → không ghi gì; mã chủ đề mới thiếu tên → lỗi", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const before = await currentVersion();
    const file = makeXlsx({ "Bài học": [HEADERS, row("Module 1", "Good question?"), row("Module 1", "Bad?", { 3: "Video" }), row("Module 1", "New topic?", { 1: "Z9" })] });
    const body = (await (await confirm(owner, file)).json()) as Preview;
    expect(body.errors).toEqual([
      { row: 3, message: "Loại bài chưa hỗ trợ: “Video” (chỉ nhận Hỏi–đáp hoặc Tự luận)." },
      { row: 4, message: "Mã chủ đề mới Z9 cần tên chủ đề." },
    ]);
    expect(await currentVersion()).toBe(before);
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM course_modules`)).rows[0].n).toBe(0);
  });

  it("khóa có hai module trùng tên với tên trong tệp → lỗi xem trước; tên chủ đề khác tên trong khóa → lỗi", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    for (const t of ["Kinh nghiệm phỏng vấn", "kinh nghiệm  phỏng vấn"]) await callAdmin(createModuleRoute, owner, "POST", "/x", { titleVi: t }, { slug: T });
    const file = makeXlsx({ "Bài học": [HEADERS, row("Kinh nghiệm phỏng vấn", "Q?", { 1: "A1", 2: "Tên khác" })] });
    const body = (await (await upload(owner, file)).json()) as Preview;
    expect(body.errors).toEqual([
      { row: 2, message: "Có hai module cùng tên “Kinh nghiệm phỏng vấn” trong khóa, đổi tên một cái trước." },
      { row: 2, message: "Mã chủ đề A1 trong khóa có tên “Học vấn và mục tiêu nghề nghiệp”, khác tên trong tệp." },
    ]);
  });

  it("300 bài trong một tệp: thêm đủ trong một lần", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const rows = Array.from({ length: 300 }, (_, i) => row(i % 2 ? "Module B" : "Module A", `Question ${i + 1}?`, { 6: "Point one | Ý một\nPoint two | Ý hai" }));
    const body = (await (await confirm(owner, makeXlsx({ "Bài học": [HEADERS, ...rows] }))).json()) as Preview;
    expect(body.errors).toEqual([]);
    expect(await lessonsOf()).toHaveLength(304);
  }, 60_000);

  it("phiên bản khóa đã đổi → 409 stale", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const res = await upload(owner, TEMPLATE, { confirm: "1", expectedVersionId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Preview).error).toBe("stale");
  });

  it("người hỗ trợ tải khung được, tải lên → 403; không phiên quản trị → 401", async () => {
    await seedContent();
    const support = await adminSess("support");
    expect((await callAdmin(templateRoute, support, "GET", "/api/quan-tri/content/template")).status).toBe(200);
    expect((await upload(support, TEMPLATE)).status).toBe(403);
    expect((await upload(null, TEMPLATE)).status).toBe(401);
  });

  it("khung tải về là xlsx (PK…), Content-Disposition attachment", async () => {
    const owner = await adminSess("owner");
    const res = await callAdmin(templateRoute, owner, "GET", "/api/quan-tri/content/template");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="khung-bai-giang-mau.xlsx"');
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.equals(TEMPLATE)).toBe(true);
  });

  it("nhập Excel 2 bài vào module 2, nhập lại content-mini.json: 2 bài Excel vẫn ở cuối khóa, vẫn ở module 2, giữ chủ đề mới", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await callAdmin(createModuleRoute, owner, "POST", "/x", { titleVi: "Module 1" }, { slug: T });
    await callAdmin(createModuleRoute, owner, "POST", "/x", { titleVi: "Module 2" }, { slug: T });
    const file = makeXlsx({ "Bài học": [HEADERS, row("Module 2", "Excel one?", { 1: "Z1", 2: "Chủ đề Excel" }), row("Module 2", "Excel two?")] });
    expect(((await (await confirm(owner, file)).json()) as Preview).errors).toEqual([]);
    const data = JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8"));
    const client = await pgAs("migrator");
    try {
      await importContent(client, data);
    } finally {
      await client.end();
    }
    expect((await lessonsOf()).slice(-2).map((l) => [l.external_id, l.module, l.topic])).toEqual([[`${T}-b5`, "Module 2", "Z1"], [`${T}-b6`, "Module 2", null]]);
    const { topics } = (await sqlAsMigrator(`SELECT topics FROM courses WHERE slug = $1`, [T])).rows[0] as { topics: { id: string }[] };
    expect(topics.map((t) => t.id)).toEqual(["A1", "B1", "Z1"]);
  });
});
