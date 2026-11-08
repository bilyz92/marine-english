import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/quan-tri/content/courses/[slug]/modules/route";
import { PATCH as patchRoute, DELETE as deleteRoute } from "@/app/api/quan-tri/content/courses/[slug]/modules/[moduleId]/route";
import { PUT as lessonModuleRoute } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/module/route";
import { importContent } from "@/worker/content-import";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";
import { seedContent } from "../helpers/content";
import { pgAs } from "../helpers/pg";

// Module khóa học (chủ 08/11/2026, docs/superpowers/plans/2026-11-08-course-modules.md, Task 1).

const T = "engine_cadet_tanker";
const D = "engine_cadet_dry_cargo";
type Mod = { id: string; titleVi: string; position: number; lessonCount: number };

const list = async (s: AdminSess, slug = T) => {
  const res = await callAdmin(listRoute, s, "GET", "/x", undefined, { slug });
  return { status: res.status, modules: res.ok ? ((await res.json()) as { modules: Mod[] }).modules : [] };
};
const create = async (s: AdminSess, titleVi: string, slug = T) => {
  const res = await callAdmin(createRoute, s, "POST", "/x", { titleVi }, { slug });
  return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
};
const patch = (s: AdminSess, moduleId: string, body: object, slug = T) => callAdmin(patchRoute, s, "PATCH", "/x", body, { slug, moduleId });
const remove = (s: AdminSess, moduleId: string, slug = T) => callAdmin(deleteRoute, s, "DELETE", "/x", undefined, { slug, moduleId });
const assign = (s: AdminSess, externalId: string, moduleId: string, slug = T) =>
  callAdmin(lessonModuleRoute, s, "PUT", "/x", { moduleId }, { slug, externalId });

/** Nhật ký thành công của một thao tác, cũ trước mới sau. */
const auditRows = async (action: string) =>
  (await sqlAsMigrator(`SELECT before, after FROM admin_audit_log WHERE action = $1 AND result = 'ok' ORDER BY at`, [action])).rows as { before: unknown; after: unknown }[];

async function reimport(edit: (data: { courses: { id: string; lesson_ids: string[] }[] }) => void) {
  const data = JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8"));
  edit(data);
  const client = await pgAs("migrator");
  try {
    await importContent(client, data);
  } finally {
    await client.end();
  }
}

describe("module khóa học", () => {
  it("tạo module đầu: mọi bài của khóa vào đó; module thứ hai rỗng, đứng sau; có nhật ký", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await create(owner, "  Kinh nghiệm phỏng vấn ")).status).toBe(200);
    expect((await create(owner, "Kinh nghiệm vận hành sửa chữa")).status).toBe(200);
    expect((await list(owner)).modules.map(({ titleVi, position, lessonCount }) => ({ titleVi, position, lessonCount }))).toEqual([
      { titleVi: "Kinh nghiệm phỏng vấn", position: 1, lessonCount: 4 },
      { titleVi: "Kinh nghiệm vận hành sửa chữa", position: 2, lessonCount: 0 },
    ]);
    const logs = await auditRows("module_create");
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => (l.after as { assignedLessons: number }).assignedLessons).sort()).toEqual([0, 4]);
  });

  it("đổi tên, chuyển xuống/lên đổi chỗ; chuyển lên ở đầu không đổi gì; mỗi thao tác có nhật ký", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const a = (await create(owner, "A")).body.id!;
    const b = (await create(owner, "B")).body.id!;
    expect((await patch(owner, a, { titleVi: "Phỏng vấn" })).status).toBe(200);
    expect((await patch(owner, a, { move: "down" })).status).toBe(200);
    expect((await list(owner)).modules.map((m) => [m.id, m.position])).toEqual([[b, 1], [a, 2]]);
    expect((await patch(owner, b, { move: "up" })).status).toBe(200);
    expect((await list(owner)).modules.map((m) => m.id)).toEqual([b, a]);
    expect((await patch(owner, a, { move: "up" })).status).toBe(200);
    expect((await list(owner)).modules.map((m) => [m.titleVi, m.position])).toEqual([["Phỏng vấn", 1], ["B", 2]]);
    expect((await auditRows("module_rename"))[0]!.before).toEqual({ titleVi: "A" });
    expect((await auditRows("module_move")).length).toBeGreaterThanOrEqual(2);
  });

  it("xếp A002 sang module 2: khóa dry_cargo (dùng chung A002) không đổi; module của khóa khác → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await create(owner, "Một");
    const two = (await create(owner, "Hai")).body.id!;
    expect((await assign(owner, "A002", two)).status).toBe(200);
    expect((await list(owner)).modules.map((m) => m.lessonCount)).toEqual([3, 1]);
    expect((await list(owner, D)).modules).toEqual([]);
    const other = (await create(owner, "Của khóa khác", D)).body.id!;
    expect((await assign(owner, "A002", other)).status).toBe(404);
    expect((await assign(owner, "H001", two)).status).toBe(404);
    expect((await auditRows("lesson_module_set"))[0]!.after).toMatchObject({ moduleId: two });
  });

  it("xóa module còn bài → 409 module_not_empty; chuyển hết bài đi rồi xóa → ok, vị trí còn liền mạch", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const one = (await create(owner, "Một")).body.id!;
    const two = (await create(owner, "Hai")).body.id!;
    const three = (await create(owner, "Ba")).body.id!;
    expect((await remove(owner, one)).status).toBe(409);
    for (const id of ["A001", "A002", "A003-1", "T001"]) expect((await assign(owner, id, three)).status).toBe(200);
    expect((await remove(owner, one)).status).toBe(200);
    expect((await list(owner)).modules.map((m) => [m.id, m.position])).toEqual([[two, 1], [three, 2]]);
    expect((await auditRows("module_delete"))[0]!.before).toMatchObject({ titleVi: "Một" });
  });

  it("tên rỗng hoặc quá 120 ký tự → 400; người hỗ trợ xem được, sửa → 403", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    expect((await create(owner, "   ")).status).toBe(400);
    expect((await create(owner, "x".repeat(121))).status).toBe(400);
    const support = await adminSess("support");
    expect((await list(support)).status).toBe(200);
    expect((await create(support, "Không được")).status).toBe(403);
  });

  it("bài bị bộ nhập bỏ khỏi khóa: không tính, không chặn xóa module; nhập lại có bài đó → về module cũ", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await create(owner, "Một");
    const two = (await create(owner, "Hai")).body.id!;
    await assign(owner, "T001", two);
    await reimport((d) => { d.courses.find((c) => c.id === T)!.lesson_ids = d.courses.find((c) => c.id === T)!.lesson_ids.filter((x) => x !== "T001"); });
    expect((await list(owner)).modules.map((m) => m.lessonCount)).toEqual([3, 0]);
    await reimport(() => undefined);
    expect((await list(owner)).modules.map((m) => m.lessonCount)).toEqual([3, 1]);
    await reimport((d) => { d.courses.find((c) => c.id === T)!.lesson_ids = d.courses.find((c) => c.id === T)!.lesson_ids.filter((x) => x !== "T001"); });
    expect((await remove(owner, two)).status).toBe(200);
  });

  it("sửa bài A002 trên web rồi nhập lại học liệu: A002 vẫn ở module 2 (xếp theo bài, không theo phiên bản)", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    await create(owner, "Một");
    const two = (await create(owner, "Hai")).body.id!;
    await assign(owner, "A002", two);
    const { rows: [c] } = await sqlAsMigrator(`SELECT current_version_id FROM courses WHERE slug = $1`, [T]);
    const { PUT: putLesson } = await import("@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/route");
    const res = await callAdmin(putLesson, owner, "PUT", "/x", {
      expectedVersionId: c.current_version_id, questionEn: "Why did you choose marine engineering?", questionVi: "", keyPoints: [], vocabulary: [], modelAnswerEn: "", modelAnswerVi: "", followUps: [],
    }, { slug: T, externalId: "A002" });
    expect(res.status).toBe(200);
    await reimport(() => undefined);
    expect((await list(owner)).modules.map((m) => m.lessonCount)).toEqual([3, 1]);
  });
});
