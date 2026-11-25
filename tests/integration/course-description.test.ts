import { describe, expect, it } from "vitest";
import { PATCH as patchCourse } from "@/app/api/quan-tri/courses/[id]/route";
import { GET as publicCourse } from "@/app/api/public/courses/[slug]/route";
import { getPublishedCourse } from "@/modules/content/catalog";
import { auditRows } from "../helpers/admin";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";
import { publish, seedContent } from "../helpers/content";

// Mô tả khóa học (chủ 26/11/2026): chủ soạn ở trang quản trị, trang khóa công khai hiện nguyên văn.
const T = "engine_cadet_tanker";
const call = (s: AdminSess, id: string, body: unknown) =>
  callAdmin(patchCourse, s, "PATCH", `/api/quan-tri/courses/${id}`, body, { id });

describe("mô tả khóa học", () => {
  it("chủ lưu mô tả: trang khóa công khai trả nguyên văn, có audit trước/sau", async () => {
    const ids = await seedContent();
    await publish(T);
    const text = "Mình là Máy trưởng tàu dầu.\n\n## Bạn sẽ học gì?\n\n* Câu hỏi song ngữ";
    const res = await call(await adminSess("owner"), ids[T], { description: `  ${text}\n` });
    expect(res.status).toBe(200);
    expect((await getPublishedCourse(T))?.description).toBe(text);
    const pub = await publicCourse(new Request(`http://localhost/api/public/courses/${T}`), { params: Promise.resolve({ slug: T }) });
    expect((await pub.json()).description).toBe(text);
    const { rows: [detail] } = await sqlAsMigrator(`SELECT before, after FROM admin_audit_log WHERE action = 'course_update'`);
    expect(detail).toMatchObject({ before: { description: null }, after: { description: text } });
  });

  it("để trống → xóa mô tả (null); đổi mô tả không đụng giá và trạng thái", async () => {
    const ids = await seedContent();
    await publish(T);
    const owner = await adminSess("owner");
    await call(owner, ids[T], { description: "Có mô tả" });
    expect((await call(owner, ids[T], { description: "   " })).status).toBe(200);
    const { rows: [row] } = await sqlAsMigrator(`SELECT description, status, price_vnd FROM courses WHERE slug = $1`, [T]);
    expect(row).toEqual({ description: null, status: "published", price_vnd: 199_000 });
    expect(await auditRows("course_update")).toHaveLength(2);
  });

  it("quá 8000 ký tự → 400; hỗ trợ → 403", async () => {
    const ids = await seedContent();
    expect((await call(await adminSess("owner"), ids[T], { description: "a".repeat(8001) })).status).toBe(400);
    expect((await call(await adminSess("support"), ids[T], { description: "x" })).status).toBe(403);
    const { rows: [row] } = await sqlAsMigrator(`SELECT description FROM courses WHERE slug = $1`, [T]);
    expect(row.description).toBeNull();
  });
});
