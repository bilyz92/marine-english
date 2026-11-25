import { describe, expect, it } from "vitest";
import { GET as listCourses } from "@/app/api/public/courses/route";
import { GET as getCourse } from "@/app/api/public/courses/[slug]/route";
import { GET as getTrial } from "@/app/api/public/courses/[slug]/trial/[position]/route";
import { POST as postOrder } from "@/app/api/me/orders/route";
import { canReadLessonVersion } from "@/modules/learn/entitlements";
import { PATCH as patchCourse } from "@/app/api/quan-tri/courses/[id]/route";
import { auditRows, insertAdmin } from "../helpers/admin";
import { adminSess, callAdmin } from "../helpers/admin-call";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { publish, seedContent } from "../helpers/content";

// Khóa 'archived' trên web công khai = "Sắp ra mắt" (chủ 25/11/2026): vẫn hiện trong danh mục, làm mờ, không giá, không học thử, không mua được.
const T = "engine_cadet_tanker";
const D = "engine_cadet_dry_cargo";
const ORIGIN = process.env.APP_ORIGIN!;
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
type Card = { slug: string; priceVnd: number | null; comingSoon: boolean; lessonCount: number; trialLessons: unknown[] };
type Group = { key: string; courseCount: number; minPriceVnd: number | null; comingSoon: boolean; courses: Card[] };
const catalog = async () => (await (await listCourses(get("/api/public/courses"))).json()) as { courses: Card[]; groups: Group[] };

async function archive(slug: string) {
  await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = $1`, [slug]);
}

describe("khóa Sắp ra mắt trên danh mục công khai", () => {
  it("khóa archived hiện cùng khóa đang bán, chỉ trường an toàn + comingSoon; nháp không bao giờ hiện", async () => {
    await seedContent();
    await publish(T, 300_000);
    await publish(D, 250_000);
    await archive(D);
    await sqlAsMigrator(`INSERT INTO courses (slug, title_vi, title_en) VALUES ('nhap_moi', 'Nháp', 'Draft')`);
    const { courses, groups } = await catalog();
    // Khóa đang mở bán lên đầu (chủ 25/11/2026), dù mã khóa xếp sau.
    expect(courses.map((c) => c.slug)).toEqual([T, D]);
    expect(courses.find((c) => c.slug === T)).toMatchObject({ comingSoon: false, priceVnd: 300_000 });
    const soon = courses.find((c) => c.slug === D)!;
    expect(soon).toEqual({ slug: D, titleVi: expect.any(String), titleEn: expect.any(String), lessonCount: expect.any(Number), priceVnd: null, trialLessons: [], comingSoon: true, category: null });
    expect(soon.lessonCount).toBeGreaterThan(0);
    // Giá của khóa sắp ra mắt không lộ ra ngoài; nhóm chỉ tính giá thấp nhất của khóa đang bán.
    expect(JSON.stringify(await catalog())).not.toContain("250000");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "khac", courseCount: 2, minPriceVnd: 300_000, comingSoon: false });
  });

  it("danh mục có khóa đang mở bán lên trước danh mục chỉ có khóa sắp ra mắt", async () => {
    await seedContent();
    await publish(T);
    await publish(D);
    await archive(T);
    const { rows: [a] } = await sqlAsMigrator(`INSERT INTO course_categories (title_vi, position) VALUES ('Đầu', 1) RETURNING id::text AS id`);
    const { rows: [b] } = await sqlAsMigrator(`INSERT INTO course_categories (title_vi, position) VALUES ('Sau', 2) RETURNING id::text AS id`);
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE slug = $2`, [a.id, T]);
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE slug = $2`, [b.id, D]);
    const { groups } = await catalog();
    expect(groups.map((g) => [g.key, g.comingSoon])).toEqual([[b.id, false], [a.id, true]]);
  });

  it("danh mục chỉ có khóa sắp ra mắt: nhóm comingSoon, không có giá", async () => {
    await seedContent();
    await publish(T);
    await archive(T);
    const { courses, groups } = await catalog();
    expect(courses.map((c) => [c.slug, c.comingSoon])).toEqual([[T, true]]);
    expect(groups.map((g) => [g.key, g.courseCount, g.minPriceVnd, g.comingSoon])).toEqual([["khac", 1, null, true]]);
  });

  it("khóa sắp ra mắt: trang chi tiết, bài học thử 404; tạo đơn bị từ chối; bài học thử không đọc được", async () => {
    await seedContent();
    await publish(T);
    await archive(T);
    expect((await getCourse(get("/x"), params({ slug: T }))).status).toBe(404);
    expect((await getTrial(get("/x"), params({ slug: T, position: "1" }))).status).toBe(404);
    const learner = await testLearner();
    const res = await postOrder(learnerRequest("/api/me/orders", learner, { method: "POST", body: { courseSlug: T, acceptTerms: true } }));
    expect([res.status, await res.json()]).toEqual([409, { error: "not_for_sale" }]);
    const { rows: [trial] } = await sqlAsMigrator(
      `SELECT cvl.lesson_version_id FROM courses c JOIN course_version_lessons cvl ON cvl.course_version_id = c.current_version_id
       WHERE c.slug = $1 AND cvl.is_free_trial LIMIT 1`, [T]);
    expect(await canReadLessonVersion(learner.userId, trial.lesson_version_id)).toBe(false);
    // Người đã có quyền học (đơn đã trả hoặc cấp quyền) vẫn học khóa sắp ra mắt như trước.
    const ownerId = await insertAdmin("chu@x.vn", "owner");
    await sqlAsMigrator(
      `INSERT INTO enrollments (user_id, course_id, source, grant_reason, granted_by) SELECT $1, id, 'grant', 'tặng', $2 FROM courses WHERE slug = $3`,
      [learner.userId, ownerId, T]);
    expect(await canReadLessonVersion(learner.userId, trial.lesson_version_id)).toBe(true);
  });

  it("Ẩn khỏi web: chủ chuyển khóa sắp ra mắt về nháp (có audit) → không còn trong danh mục; chuyển lại Sắp ra mắt → hiện lại", async () => {
    const ids = await seedContent();
    await publish(T);
    await archive(T);
    const owner = await adminSess("owner");
    expect((await callAdmin(patchCourse, owner, "PATCH", "/x", { status: "draft" }, { id: ids[T]! })).status).toBe(200);
    expect((await auditRows("course_update")).map((r) => [r.target_id, r.result])).toEqual([[ids[T], "ok"]]);
    expect(await catalog()).toEqual({ courses: [], groups: [] });
    // Nháp → Sắp ra mắt lại được (không cần giá), lại hiện mờ.
    expect((await callAdmin(patchCourse, owner, "PATCH", "/x", { status: "archived" }, { id: ids[T]! })).status).toBe(200);
    expect((await catalog()).courses.map((c) => [c.slug, c.comingSoon])).toEqual([[T, true]]);
  });
});
