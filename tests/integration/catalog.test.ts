import { describe, expect, it } from "vitest";
import { GET as listCourses } from "@/app/api/public/courses/route";
import { GET as getCourse } from "@/app/api/public/courses/[slug]/route";
import { GET as getTrial } from "@/app/api/public/courses/[slug]/trial/[position]/route";
import { PATCH as patchCourse } from "@/app/api/quan-tri/courses/[id]/route";
import { withTx } from "@/lib/db";
import { createSession } from "@/modules/sessions/sessions";
import { POST as createModuleRoute } from "@/app/api/quan-tri/content/courses/[slug]/modules/route";
import { PUT as lessonModuleRoute } from "@/app/api/quan-tri/content/courses/[slug]/lessons/[externalId]/module/route";
import { POST as createCategoryRoute } from "@/app/api/quan-tri/categories/route";
import { PUT as courseCategoryRoute } from "@/app/api/quan-tri/courses/[id]/category/route";
import { auditRows, insertAdmin } from "../helpers/admin";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";
import { publish, seedContent } from "../helpers/content";

const ORIGIN = process.env.APP_ORIGIN!;
type Detail = { lessonCount: number; modules: { id: string | null; titleVi: string; lessonCount: number; trial: { position: number; externalId: string; title: string }[] }[] };
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function admin(role: "owner" | "support", authAt = new Date()) {
  const adminId = await insertAdmin(`${role}${Math.random()}@x.vn`, role);
  return withTx((tx) => createSession(tx, { realm: "admin", adminId, authAt }));
}

function patch(id: string, s: { token: string; csrf: string }, body: unknown) {
  return patchCourse(
    new Request(`${ORIGIN}/api/quan-tri/courses/${id}`, {
      method: "PATCH",
      headers: { cookie: `__Host-me_admin=${s.token}`, origin: ORIGIN, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params({ id }),
  );
}

describe("danh mục công khai", () => {
  it("khóa draft không lộ; publish rồi mới thấy, kèm 2 bài học thử có tiêu đề tiếng Việt", async () => {
    await seedContent();
    expect(await (await listCourses(get("/api/public/courses"))).json()).toEqual({ courses: [], groups: [] });
    expect((await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).status).toBe(404);
    expect((await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position: "1" }))).status).toBe(404);
    await publish("engine_cadet_tanker");
    const { courses } = (await (await listCourses(get("/api/public/courses"))).json()) as { courses: { slug: string; priceVnd: number; lessonCount: number; trialLessons: { position: number; externalId: string; title: string }[] }[] };
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ slug: "engine_cadet_tanker", priceVnd: 199_000, lessonCount: 4 });
    expect(courses[0]!.trialLessons.map((l) => l.externalId)).toEqual(["A001", "A002"]);
    expect(courses[0]!.trialLessons[0]!.title).toMatch(/^Hãy giới thiệu/);
    // Khóa chưa chia module: một nhóm "Nội dung khóa học", chỉ bài học thử có tiêu đề (chủ 08/11/2026: người chưa mua chỉ thấy module).
    const detail = (await (await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).json()) as Detail;
    expect(detail).not.toHaveProperty("lessons");
    expect(detail).not.toHaveProperty("topics");
    expect(detail.modules).toEqual([{ id: null, titleVi: "Nội dung khóa học", lessonCount: 4, trial: courses[0]!.trialLessons }]);
  });

  it("API công khai không chứa câu hỏi của bài không học thử", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const body = await (await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).text();
    expect(body).not.toContain("T001");
    expect(body).not.toContain("tanker cargo support systems");
    expect(body).not.toContain("hệ thống hỗ trợ hàng");
  });

  it("mỗi module có lessonCount đúng và đủ 2 bài học thử; bài chưa xếp vào nhóm Bài khác ở cuối", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const s = await adminSess("owner");
    const createModule = async (titleVi: string) =>
      ((await (await callAdmin(createModuleRoute, s, "POST", "/x", { titleVi }, { slug: "engine_cadet_tanker" })).json()) as { id: string }).id;
    await createModule("Kinh nghiệm phỏng vấn");
    const m2 = await createModule("Kinh nghiệm vận hành");
    expect((await callAdmin(lessonModuleRoute, s, "PUT", "/x", { moduleId: m2 }, { slug: "engine_cadet_tanker", externalId: "T001" })).status).toBe(200);
    const detail = (await (await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).json()) as Detail;
    expect(detail.modules.map((m) => [m.titleVi, m.lessonCount, m.trial.length])).toEqual([["Kinh nghiệm phỏng vấn", 3, 2], ["Kinh nghiệm vận hành", 1, 0]]);
    expect(detail.modules.reduce((n, m) => n + m.lessonCount, 0)).toBe(detail.lessonCount);
    await sqlAsMigrator(`DELETE FROM course_lesson_modules WHERE lesson_id = (SELECT id FROM lessons WHERE external_id = 'T001')`);
    const after = (await (await getCourse(get("/x"), params({ slug: "engine_cadet_tanker" }))).json()) as Detail;
    expect(after.modules.map((m) => [m.id === null, m.titleVi, m.lessonCount])).toEqual([[false, "Kinh nghiệm phỏng vấn", 3], [true, "Bài khác", 1]]);
  });

  it("bài học thử: vị trí 1–2 có nội dung; vị trí 3 (hết học thử từ 17/11/2026), 4, 0, abc → 404", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const ok = await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position: "2" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { externalId: string }).externalId).toBe("A002");
    for (const position of ["3", "4", "0", "abc", "-1"]) {
      expect((await getTrial(get("/x"), params({ slug: "engine_cadet_tanker", position }))).status, position).toBe(404);
    }
  });
});

describe("quản trị sửa giá và trạng thái", () => {
  it("publish chưa có giá → 409; owner đặt giá + publish → ok, audit có trước/sau", async () => {
    const ids = await seedContent();
    const owner = await admin("owner");
    const id = ids.engine_cadet_tanker!;
    const early = await patch(id, owner, { status: "published" });
    expect([early.status, await early.json()]).toEqual([409, { error: "needs_price" }]);
    expect((await patch(id, owner, { priceVnd: 249_000, status: "published" })).status).toBe(200);
    const [row] = await auditRows("course_update");
    expect(row).toMatchObject({ result: "ok", target_id: id });
    expect((await patch(crypto.randomUUID(), owner, { priceVnd: 1000 })).status).toBe(404);
    expect((await patch(id, owner, { priceVnd: 0 })).status).toBe(400);
  });

  it("support → 403 role; owner lâu chưa xác thực → 403 reauth_required", async () => {
    const ids = await seedContent();
    const support = await admin("support");
    const res = await patch(ids.engine_cadet_tanker!, support, { priceVnd: 1000 });
    expect([res.status, await res.json()]).toEqual([403, { error: "role" }]);
    const stale = await admin("owner", new Date(Date.now() - 11 * 60_000));
    expect((await patch(ids.engine_cadet_tanker!, stale, { priceVnd: 1000 })).status).toBe(403);
  });
});

// Danh mục khóa học trên trang công khai (docs/superpowers/plans/2026-11-14-course-categories.md, Task 2).
type Card = { slug: string; priceVnd: number; category: { id: string; titleVi: string; titleEn: string | null; parentTitleVi: string | null; parentTitleEn: string | null } | null };
type Group = {
  id: string | null; key: string; titleVi: string; titleEn: string | null; imageUrl: string | null; courseCount: number; minPriceVnd: number | null; comingSoon: boolean;
  courses: Card[]; subgroups: { id: string; titleVi: string; courses: Card[] }[];
};

describe("danh mục khóa học công khai", () => {
  const T = "engine_cadet_tanker";
  const D = "engine_cadet_dry_cargo";
  async function setup() {
    const ids = await seedContent();
    const s = await adminSess("owner");
    const cat = async (titleVi: string, extra: { titleEn?: string; parentId?: string } = {}) =>
      ((await (await callAdmin(createCategoryRoute, s, "POST", "/x", { titleVi, ...extra })).json()) as { id: string }).id;
    const put = async (slug: string, categoryId: string | null) =>
      expect((await callAdmin(courseCategoryRoute, s, "PUT", "/x", { categoryId }, { id: ids[slug]! })).status).toBe(200);
    return { cat, put };
  }
  const catalog = async () => (await (await listCourses(get("/api/public/courses"))).json()) as { courses: Card[]; groups: Group[] };

  it("khóa đang bán gom theo danh mục, đúng thứ tự; danh mục rỗng hoặc chỉ có khóa nháp thì không hiện, chỉ có khóa sắp ra mắt thì hiện mờ", async () => {
    const { cat, put } = await setup();
    await publish(T, 300_000);
    await publish(D, 200_000);
    const a = await cat("Phụ máy", { titleEn: "Wiper" });
    await cat("Thợ máy");
    const c = await cat("Máy trưởng");
    await put(D, a);
    await put(T, c);
    const { groups } = await catalog();
    expect(groups.map((g) => [g.key, g.titleVi, g.titleEn, g.courseCount, g.minPriceVnd, g.courses.map((x) => x.slug)])).toEqual([
      [a, "Phụ máy", "Wiper", 1, 200_000, [D]],
      [c, "Máy trưởng", null, 1, 300_000, [T]],
    ]);
    expect(groups[0]).toMatchObject({ id: a, imageUrl: null, subgroups: [] });
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = $1`, [D]);
    expect((await catalog()).groups.map((g) => [g.id, g.comingSoon, g.minPriceVnd])).toEqual([[c, false, 300_000], [a, true, null]]); // danh mục có khóa đang bán lên trước (chủ 25/11/2026)
    await sqlAsMigrator(`UPDATE courses SET status = 'draft' WHERE slug = $1`, [D]);
    expect((await catalog()).groups.map((g) => g.id)).toEqual([c]);
  });

  it("khóa trong danh mục con nằm trong subgroups của cha; courseCount và minPriceVnd tính cả khóa con", async () => {
    const { cat, put } = await setup();
    await publish(T, 300_000);
    await publish(D, 250_000);
    const a = await cat("Máy hai", { titleEn: "2/E" });
    const a1 = await cat("Tàu dầu", { parentId: a, titleEn: "Tanker" });
    await cat("Tàu rỗng", { parentId: a });
    await put(T, a1);
    await put(D, a);
    let [g] = (await catalog()).groups;
    expect(g).toMatchObject({ id: a, courseCount: 2, minPriceVnd: 250_000 });
    expect(g!.courses.map((x) => x.slug)).toEqual([D]);
    expect(g!.subgroups.map((sg) => [sg.id, sg.titleVi, sg.courses.map((x) => x.slug)])).toEqual([[a1, "Tàu dầu", [T]]]);
    // Chỉ còn khóa trong danh mục con: vẫn hiện danh mục, số khóa và giá thấp nhất theo khóa con.
    await put(D, null);
    [g] = (await catalog()).groups;
    expect(g).toMatchObject({ id: a, courseCount: 1, minPriceVnd: 300_000, courses: [] });
    const { courses } = await catalog();
    expect(courses.find((x) => x.slug === T)!.category).toEqual({ id: a1, titleVi: "Tàu dầu", titleEn: "Tanker", parentTitleVi: "Máy hai", parentTitleEn: "2/E" });
  });

  it("khóa chưa gắn danh mục ở nhóm Khóa khác cuối cùng (key khac)", async () => {
    const { cat, put } = await setup();
    await publish(T);
    await publish(D);
    const a = await cat("Phụ máy");
    await put(T, a);
    const { groups, courses } = await catalog();
    expect(groups.map((g) => [g.id, g.key, g.titleVi, g.courses.map((x) => x.slug)])).toEqual([[a, a, "Phụ máy", [T]], [null, "khac", "Khóa khác", [D]]]);
    expect(groups[1]).toMatchObject({ titleEn: null, imageUrl: null, courseCount: 1, subgroups: [] });
    expect(courses.find((x) => x.slug === D)!.category).toBeNull();
    expect(courses.find((x) => x.slug === T)!.category).toEqual({ id: a, titleVi: "Phụ máy", titleEn: null, parentTitleVi: null, parentTitleEn: null });
  });

  it("API công khai trả đúng { courses, groups }; API chi tiết khóa không có trường category", async () => {
    const { cat, put } = await setup();
    await publish(T);
    await put(T, await cat("Phụ máy"));
    const body = (await catalog()) as unknown as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["courses", "groups"]);
    expect((body.courses as Card[])[0]).toHaveProperty("category");
    const detail = (await (await getCourse(get("/x"), params({ slug: T }))).json()) as Record<string, unknown>;
    expect(detail).not.toHaveProperty("category");
  });
});
