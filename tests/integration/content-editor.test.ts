import { describe, expect, it } from "vitest";
import { POST as createCourse } from "@/app/api/quan-tri/content/courses/route";
import { GET as courseLessons } from "@/app/api/quan-tri/content/courses/[slug]/route";
import { POST as addLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/route";
import { GET as getLesson, PUT as putLesson } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/route";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

// Bước 5 của docs/superpowers/plans/2026-11-02-content-authoring.md: chủ sửa và thêm bài trên web.

type Listing = { course: { slug: string; status: string; currentVersionId: string | null }; lessons: { position: number; externalId: string; questionEn: string; isFreeTrial: boolean }[] };
type Lesson = { externalId: string; content: Record<string, unknown> & { question: { text: { en: string; vi?: string } } } };

const fields = (en: string, extra: Record<string, unknown> = {}) => ({
  questionEn: en,
  questionVi: `${en} (vi)`,
  keyPoints: [{ en: "Point one", vi: "Ý một" }],
  vocabulary: [{ en: "pump", vi: "bơm" }],
  modelAnswerEn: "My answer.",
  modelAnswerVi: "Câu trả lời.",
  followUps: [{ en: "Why?", vi: "Vì sao?" }],
  ...extra,
});

async function listing(s: AdminSess, slug: string) {
  const res = await callAdmin(courseLessons, s, "GET", `/api/quan-tri/content/courses/${slug}`, undefined, { slug });
  expect(res.status).toBe(200);
  return (await res.json()) as Listing;
}

const put = (s: AdminSess, slug: string, externalId: string, body: unknown) =>
  callAdmin(putLesson, s, "PUT", `/api/quan-tri/content/courses/${slug}/lessons/${externalId}`, body, { slug, externalId });
const add = (s: AdminSess, slug: string, body: unknown) => callAdmin(addLesson, s, "POST", `/api/quan-tri/content/courses/${slug}/lessons`, body, { slug });

describe("soạn bài trên web", () => {
  it("sửa bài: phiên bản bài và khóa mới; giữ trường khác; bài cũ không đổi; khóa khác dùng chung bài không đổi; audit", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const before = await listing(owner, "engine_cadet_tanker");
    const dry = await listing(owner, "engine_cadet_dry_cargo");
    const old = (await sqlAsMigrator(`SELECT lv.content FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'A001'`)).rows[0].content;

    const res = await put(owner, "engine_cadet_tanker", "A001", { expectedVersionId: before.course.currentVersionId, ...fields("Introduce yourself, please.") });
    expect(res.status).toBe(200);
    const after = await listing(owner, "engine_cadet_tanker");
    expect(after.course.currentVersionId).not.toBe(before.course.currentVersionId);
    expect(after.lessons.map((l) => l.externalId)).toEqual(before.lessons.map((l) => l.externalId));
    expect(after.lessons[0]).toMatchObject({ questionEn: "Introduce yourself, please.", isFreeTrial: true });

    const lesson = (await (await callAdmin(getLesson, owner, "GET", "/x", undefined, { slug: "engine_cadet_tanker", externalId: "A001" })).json()) as Lesson;
    expect(lesson.content.question.text).toEqual({ en: "Introduce yourself, please.", vi: "Introduce yourself, please. (vi)" });
    expect(lesson.content.learning_material).toEqual(old.learning_material);
    expect(lesson.content.activities).toEqual(old.activities);
    expect(lesson.content.vocabulary).toEqual([{ id: "A001.vocab.1", text: { en: "pump", vi: "bơm" } }]);

    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM lesson_versions lv JOIN lessons l ON l.id = lv.lesson_id WHERE l.external_id = 'A001'`)).rows[0].n).toBe(2);
    expect((await listing(owner, "engine_cadet_dry_cargo")).course.currentVersionId).toBe(dry.course.currentVersionId);
    const [row] = await auditRows("lesson_edit");
    expect(row).toMatchObject({ admin_user_id: owner.adminId, target_id: "engine_cadet_tanker/A001", result: "ok" });

    // Lưu lại y nguyên: không tạo phiên bản mới.
    const ids = (key: string) => (lesson.content[key] as { id: string }[]).map((x) => x.id);
    const same = await put(owner, "engine_cadet_tanker", "A001", {
      expectedVersionId: after.course.currentVersionId,
      ...fields("Introduce yourself, please."),
      keyPoints: [{ id: ids("key_points")[0], en: "Point one", vi: "Ý một" }],
      followUps: [{ id: ids("follow_up_questions")[0], en: "Why?", vi: "Vì sao?" }],
    });
    expect(same.status).toBe(200);
    expect((await listing(owner, "engine_cadet_tanker")).course.currentVersionId).toBe(after.course.currentVersionId);
  });

  it("khóa mới rỗng: thêm bài đầu tiên tạo phiên bản 1; bài thêm sau nối cuối, 3 bài đầu học thử", async () => {
    const owner = await adminSess("owner");
    const created = await callAdmin(createCourse, owner, "POST", "/api/quan-tri/content/courses", { slug: "khoa_moi", titleVi: "Khóa mới", titleEn: "New course" });
    expect(created.status).toBe(200);
    expect((await callAdmin(createCourse, owner, "POST", "/x", { slug: "khoa_moi", titleVi: "A", titleEn: "B" })).status).toBe(409);
    expect((await callAdmin(createCourse, owner, "POST", "/x", { slug: "Khóa Sai!", titleVi: "A", titleEn: "B" })).status).toBe(400);
    expect((await listing(owner, "khoa_moi")).course).toMatchObject({ status: "draft", currentVersionId: null });

    let version: string | null = null;
    for (const n of [1, 2, 3, 4]) {
      const res = await add(owner, "khoa_moi", { expectedVersionId: version, ...fields(`Question ${n}?`) });
      expect(res.status).toBe(200);
      version = (await listing(owner, "khoa_moi")).course.currentVersionId;
    }
    const l = await listing(owner, "khoa_moi");
    expect(l.lessons.map((x) => [x.position, x.externalId, x.isFreeTrial])).toEqual([
      [1, "khoa_moi-b1", true], [2, "khoa_moi-b2", true], [3, "khoa_moi-b3", true], [4, "khoa_moi-b4", false],
    ]);
    expect(await auditRows("lesson_add")).toHaveLength(4);
    expect(await auditRows("course_create")).toHaveLength(1);
  });

  it("khóa đang bán: sửa và thêm đều cần confirmLive", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const owner = await adminSess("owner");
    const v = (await listing(owner, "engine_cadet_tanker")).course.currentVersionId;
    const edit = await put(owner, "engine_cadet_tanker", "A002", { expectedVersionId: v, ...fields("Edited?") });
    expect(edit.status).toBe(409);
    expect(await edit.json()).toMatchObject({ error: "needs_confirm" });
    expect((await add(owner, "engine_cadet_tanker", { expectedVersionId: v, ...fields("New?") })).status).toBe(409);
    expect((await put(owner, "engine_cadet_tanker", "A002", { expectedVersionId: v, confirmLive: true, ...fields("Edited?") })).status).toBe(200);
  });

  it("hai lần sửa cùng phiên bản → lần sau 409 stale; bài không thuộc khóa → 404", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const v = (await listing(owner, "engine_cadet_tanker")).course.currentVersionId;
    const [a, b] = await Promise.all([
      put(owner, "engine_cadet_tanker", "A001", { expectedVersionId: v, ...fields("First?") }),
      put(owner, "engine_cadet_tanker", "A002", { expectedVersionId: v, ...fields("Second?") }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await (a.status === 409 ? a : b).json()).toMatchObject({ error: "stale" });
    const now = (await listing(owner, "engine_cadet_tanker")).course.currentVersionId;
    expect((await put(owner, "engine_cadet_tanker", "KHONG-CO", { expectedVersionId: now, ...fields("X?") })).status).toBe(404);
  });

  it("đang có lần nhập giữ khóa nội dung → sửa bài trả 409 busy", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const v = (await listing(owner, "engine_cadet_tanker")).course.currentVersionId;
    const holder = await pgAs("migrator");
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT 1 FROM pg_advisory_xact_lock(hashtext('content-import'))`);
      const res = await put(owner, "engine_cadet_tanker", "A001", { expectedVersionId: v, ...fields("Blocked?") });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: "busy" });
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
  }, 30_000);

  it("hỗ trợ xem được danh sách bài nhưng không sửa, thêm, tạo khóa; dữ liệu sai → 400", async () => {
    await seedContent();
    const support = await adminSess("support");
    const owner = await adminSess("owner");
    const v = (await listing(support, "engine_cadet_tanker")).course.currentVersionId;
    expect((await put(support, "engine_cadet_tanker", "A001", { expectedVersionId: v, ...fields("X?") })).status).toBe(403);
    expect((await add(support, "engine_cadet_tanker", { expectedVersionId: v, ...fields("X?") })).status).toBe(403);
    expect((await callAdmin(createCourse, support, "POST", "/x", { slug: "abc_def", titleVi: "A", titleEn: "B" })).status).toBe(403);
    expect((await put(owner, "engine_cadet_tanker", "A001", { expectedVersionId: v, ...fields("") })).status).toBe(400);
  });

  it("bỏ một mục: giữ đúng mã và dữ liệu kèm theo của các mục còn lại; mục mới có mã mới, không thừa hưởng", async () => {
    await seedContent();
    const owner = await adminSess("owner");
    const v = (await listing(owner, "engine_cadet_tanker")).course.currentVersionId;
    const res = await put(owner, "engine_cadet_tanker", "A001", {
      expectedVersionId: v,
      ...fields("Introduce yourself."),
      keyPoints: [{ id: "A001.kp.2", en: "Second point", vi: "" }, { id: "A001.kp.3", en: "Third point", vi: "" }, { en: "Brand new point", vi: "" }],
      followUps: [{ en: "A new follow-up?", vi: "" }],
    });
    expect(res.status).toBe(200);
    const lesson = (await (await callAdmin(getLesson, owner, "GET", "/x", undefined, { slug: "engine_cadet_tanker", externalId: "A001" })).json()) as Lesson;
    const kps = lesson.content.key_points as { id: string; order: number; assessment_scope?: string; text: { en: string } }[];
    expect(kps.map((k) => [k.id, k.order, k.text.en])).toEqual([["A001.kp.2", 1, "Second point"], ["A001.kp.3", 2, "Third point"], ["A001.kp.4", 3, "Brand new point"]]);
    expect(kps[0]!.assessment_scope).toBe("this_question");
    expect(kps[2]).not.toHaveProperty("assessment_scope");
    const fus = lesson.content.follow_up_questions as Record<string, unknown>[];
    expect(fus).toHaveLength(1);
    expect(fus[0]!.id).not.toBe("A001.probe.1");
    expect(fus[0]).not.toHaveProperty("model_answer");
  });
});

