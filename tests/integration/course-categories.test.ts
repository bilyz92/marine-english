import { describe, expect, it } from "vitest";
import { GET as listRoute, POST as createRoute } from "@/app/api/quan-tri/categories/route";
import { PATCH as patchRoute, DELETE as deleteRoute } from "@/app/api/quan-tri/categories/[id]/route";
import { PUT as putImageRoute, DELETE as deleteImageRoute } from "@/app/api/quan-tri/categories/[id]/image/route";
import { PUT as courseCategoryRoute } from "@/app/api/quan-tri/courses/[id]/category/route";
import { GET as adminCourses } from "@/app/api/quan-tri/courses/route";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";
import { seedContent } from "../helpers/content";

// Danh mục khóa học hai cấp (chủ 14/11/2026, docs/superpowers/plans/2026-11-14-course-categories.md, Task 1).

type Cat = { id: string; parentId: string | null; seedKey: string | null; urlSlug: string; titleVi: string; titleEn: string | null; imageUrl: string | null; position: number; courseCount: number };

const list = async (s: AdminSess) => {
  const res = await callAdmin(listRoute, s, "GET", "/x");
  return { status: res.status, categories: res.ok ? ((await res.json()) as { categories: Cat[] }).categories : [] };
};
const create = async (s: AdminSess, body: { titleVi: string; titleEn?: string; parentId?: string }) => {
  const res = await callAdmin(createRoute, s, "POST", "/x", body);
  return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
};
const patch = (s: AdminSess, id: string, body: object) => callAdmin(patchRoute, s, "PATCH", "/x", body, { id });
const remove = (s: AdminSess, id: string) => callAdmin(deleteRoute, s, "DELETE", "/x", undefined, { id });
const setCourse = (s: AdminSess, courseId: string, categoryId: string | null) =>
  callAdmin(courseCategoryRoute, s, "PUT", "/x", { categoryId }, { id: courseId });
const errorOf = async (res: Response) => ((await res.json()) as { error?: string }).error;

function putImage(s: AdminSess, id: string, bytes: Buffer, contentLength?: string) {
  const headers: Record<string, string> = { cookie: `__Host-me_admin=${s.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": s.csrf, "content-type": "application/octet-stream" };
  if (contentLength) headers["content-length"] = contentLength;
  return putImageRoute(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/categories/${id}/image`, { method: "PUT", headers, body: new Uint8Array(bytes) }), {
    params: Promise.resolve({ id }),
  });
}
const removeImage = (s: AdminSess, id: string) => callAdmin(deleteImageRoute, s, "DELETE", "/x", undefined, { id });

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("anh-jpg")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("anh-png")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 anh")]);
const GIF = Buffer.from("GIF89a-anh-gif");

const actions = async () =>
  (await sqlAsMigrator(`SELECT action FROM admin_audit_log WHERE result = 'ok' ORDER BY at`)).rows.map((r) => r.action as string);

describe("danh mục khóa học", () => {
  it("tạo danh mục và danh mục con, liệt kê đúng thứ tự cha → con", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "  Thợ   máy ", titleEn: "Oiler" })).body.id!;
    const b = (await create(owner, { titleVi: "Máy hai" })).body.id!;
    const a1 = (await create(owner, { titleVi: "Tàu dầu", parentId: a })).body.id!;
    const a2 = (await create(owner, { titleVi: "Tàu hàng", parentId: a })).body.id!;
    const { categories } = await list(owner);
    expect(categories.map((c) => [c.id, c.parentId, c.titleVi, c.position])).toEqual([
      [a, null, "Thợ máy", 1], [a1, a, "Tàu dầu", 1], [a2, a, "Tàu hàng", 2], [b, null, "Máy hai", 2],
    ]);
    expect(categories[0]).toMatchObject({ titleEn: "Oiler", imageUrl: null, courseCount: 0, seedKey: null });
  });

  it("danh mục con của danh mục con → 400 category_depth; cha không tồn tại → 404", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const a1 = (await create(owner, { titleVi: "A1", parentId: a })).body.id!;
    const deep = await create(owner, { titleVi: "A1x", parentId: a1 });
    expect([deep.status, deep.body.error]).toEqual([400, "category_depth"]);
    expect((await create(owner, { titleVi: "X", parentId: "00000000-0000-4000-8000-000000000001" })).status).toBe(404);
    // Trigger DB cũng chặn, kể cả khi đi vòng qua dịch vụ.
    await expect(sqlAsMigrator(`INSERT INTO course_categories (parent_id, title_vi, position) VALUES ($1, 'sâu', 1)`, [a1])).rejects.toThrow(/category_depth/);
  });

  it("trùng tên cùng cha (không phân biệt hoa thường, khoảng trắng) → 409; khác cha thì được; tên rỗng/quá dài → 400", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "Máy ba" })).body.id!;
    const dup = await create(owner, { titleVi: " MÁY  BA " });
    expect([dup.status, dup.body.error]).toEqual([409, "category_name_taken"]);
    // Cùng chữ nhưng gõ dạng dấu tách (NFD, ví dụ dán từ macOS) vẫn là trùng tên.
    expect((await create(owner, { titleVi: "Máy ba".normalize("NFD") })).status).toBe(409);
    expect((await create(owner, { titleVi: "Máy ba", parentId: a })).status).toBe(200);
    expect((await create(owner, { titleVi: "   " })).status).toBe(400);
    expect((await create(owner, { titleVi: "x".repeat(81) })).status).toBe(400);
    const b = (await create(owner, { titleVi: "Máy tư" })).body.id!;
    const rename = await patch(owner, b, { titleVi: "máy ba" });
    expect([rename.status, await errorOf(rename)]).toEqual([409, "category_name_taken"]);
  });

  it("dời lên/xuống đổi chỗ với anh em, đầu/cuối không đổi; ở cấp 1 và ở danh mục con đều đúng", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const b = (await create(owner, { titleVi: "B" })).body.id!;
    const c = (await create(owner, { titleVi: "C" })).body.id!;
    const b1 = (await create(owner, { titleVi: "B1", parentId: b })).body.id!;
    const b2 = (await create(owner, { titleVi: "B2", parentId: b })).body.id!;
    expect((await patch(owner, a, { move: "up" })).status).toBe(200);
    expect((await patch(owner, c, { move: "down" })).status).toBe(200);
    expect((await patch(owner, c, { move: "up" })).status).toBe(200);
    expect((await patch(owner, b2, { move: "up" })).status).toBe(200);
    expect((await patch(owner, b2, { move: "up" })).status).toBe(200);
    const top = (await list(owner)).categories;
    expect(top.map((x) => [x.id, x.position])).toEqual([[a, 1], [c, 2], [b, 3], [b2, 1], [b1, 2]]);
  });

  it("xóa còn khóa (kể cả nháp) hoặc còn con → 409 category_not_empty; rỗng thì xóa được", async () => {
    const ids = await seedContent();
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const b = (await create(owner, { titleVi: "B" })).body.id!;
    await create(owner, { titleVi: "B1", parentId: b });
    expect((await setCourse(owner, ids.engine_cadet_tanker!, a)).status).toBe(200);
    const hasCourse = await remove(owner, a);
    expect([hasCourse.status, await errorOf(hasCourse)]).toEqual([409, "category_not_empty"]);
    const hasChild = await remove(owner, b);
    expect([hasChild.status, await errorOf(hasChild)]).toEqual([409, "category_not_empty"]);
    expect((await setCourse(owner, ids.engine_cadet_tanker!, null)).status).toBe(200);
    expect((await remove(owner, a)).status).toBe(200);
    expect((await remove(owner, "00000000-0000-4000-8000-000000000001")).status).toBe(404);
  });

  it("xóa danh mục giữa → vị trí anh em liền 1..n; sau đó dời và tạo mới vẫn đúng", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const b = (await create(owner, { titleVi: "B" })).body.id!;
    const c = (await create(owner, { titleVi: "C" })).body.id!;
    expect((await remove(owner, b)).status).toBe(200);
    expect((await list(owner)).categories.map((x) => [x.id, x.position])).toEqual([[a, 1], [c, 2]]);
    expect((await patch(owner, c, { move: "up" })).status).toBe(200);
    const d = (await create(owner, { titleVi: "D" })).body.id!;
    expect((await list(owner)).categories.map((x) => [x.id, x.position])).toEqual([[c, 1], [a, 2], [d, 3]]);
  });

  it("hai yêu cầu tạo cùng tên cùng lúc → một thành công, một 409 category_name_taken", async () => {
    const owner = await adminSess("owner");
    const results = await Promise.all([create(owner, { titleVi: "Trùng" }), create(owner, { titleVi: "trùng" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)!.body.error).toBe("category_name_taken");
  });

  it("hai yêu cầu tạo khác tên cùng lúc cùng cha → cả hai thành công, vị trí 1..n liền", async () => {
    const owner = await adminSess("owner");
    const p = (await create(owner, { titleVi: "Cha" })).body.id!;
    const top = await Promise.all(["X", "Y", "Z"].map((t) => create(owner, { titleVi: t })));
    const sub = await Promise.all(["s1", "s2", "s3"].map((t) => create(owner, { titleVi: t, parentId: p })));
    expect([...top, ...sub].map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const all = (await list(owner)).categories;
    expect(all.filter((c) => c.parentId === null).map((c) => c.position)).toEqual([1, 2, 3, 4]);
    expect(all.filter((c) => c.parentId === p).map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it("xóa danh mục cha và thêm danh mục con cùng lúc → một bên thành công, bên kia 409/404, không 500", async () => {
    const owner = await adminSess("owner");
    for (let i = 0; i < 5; i++) {
      const p = (await create(owner, { titleVi: `Cha ${i}` })).body.id!;
      const [del, add] = await Promise.all([remove(owner, p), create(owner, { titleVi: "Con", parentId: p })]);
      const pair = [del.status, add.status];
      expect([[200, 404], [409, 200]]).toContainEqual(pair);
      if (add.status === 200) {
        await remove(owner, add.body.id!);
        await remove(owner, p);
      }
    }
  });

  it("gắn khóa vào danh mục, bỏ gắn (null); danh mục/khóa không tồn tại → 404; GET /api/quan-tri/courses trả categoryId", async () => {
    const ids = await seedContent();
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const a1 = (await create(owner, { titleVi: "A1", parentId: a })).body.id!;
    expect((await setCourse(owner, ids.engine_cadet_tanker!, a1)).status).toBe(200);
    const courses = async () =>
      ((await (await callAdmin(adminCourses, owner, "GET", "/x")).json()) as { courses: { slug: string; categoryId: string | null }[] }).courses;
    expect((await courses()).find((c) => c.slug === "engine_cadet_tanker")!.categoryId).toBe(a1);
    expect((await courses()).find((c) => c.slug === "engine_cadet_dry_cargo")!.categoryId).toBeNull();
    expect((await list(owner)).categories.find((c) => c.id === a1)!.courseCount).toBe(1);
    expect((await setCourse(owner, ids.engine_cadet_tanker!, "00000000-0000-4000-8000-000000000001")).status).toBe(404);
    expect((await setCourse(owner, "00000000-0000-4000-8000-000000000002", a)).status).toBe(404);
    expect((await setCourse(owner, ids.engine_cadet_tanker!, null)).status).toBe(200);
    expect((await courses()).find((c) => c.slug === "engine_cadet_tanker")!.categoryId).toBeNull();
  });

  it("support: GET 200, POST/PATCH/DELETE/PUT (cả ảnh) → 403; không phiên → 401", async () => {
    const ids = await seedContent();
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const support = await adminSess("support");
    expect((await list(support)).status).toBe(200);
    expect((await create(support, { titleVi: "B" })).status).toBe(403);
    expect((await patch(support, a, { titleVi: "B" })).status).toBe(403);
    expect((await patch(support, a, { move: "down" })).status).toBe(403);
    expect((await remove(support, a)).status).toBe(403);
    expect((await setCourse(support, ids.engine_cadet_tanker!, a)).status).toBe(403);
    expect((await putImage(support, a, PNG)).status).toBe(403);
    expect((await removeImage(support, a)).status).toBe(403);
    const anon = await listRoute(new Request(`${process.env.APP_ORIGIN}/api/quan-tri/categories`));
    expect(anon.status).toBe(401);
  });

  it("đặt, đổi, xóa titleEn", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "Máy trưởng" })).body.id!;
    const titleEn = async () => (await list(owner)).categories[0]!.titleEn;
    expect(await titleEn()).toBeNull();
    expect((await patch(owner, a, { titleEn: " C/E " })).status).toBe(200);
    expect(await titleEn()).toBe("C/E");
    expect((await patch(owner, a, { titleEn: "Chief Engineer", titleVi: "Máy trưởng tàu" })).status).toBe(200);
    expect((await list(owner)).categories[0]).toMatchObject({ titleEn: "Chief Engineer", titleVi: "Máy trưởng tàu" });
    expect((await patch(owner, a, { titleEn: null })).status).toBe(200);
    expect(await titleEn()).toBeNull();
    expect((await patch(owner, a, { titleEn: "x".repeat(81) })).status).toBe(400);
  });

  it("ảnh cho danh mục không tồn tại → 404 và không ghi tệp", async () => {
    const owner = await adminSess("owner");
    const { readdir } = await import("node:fs/promises");
    const root = `${process.env.MEDIA_ROOT ?? "./media"}/public`;
    const before = await readdir(root).catch(() => [] as string[]);
    const odd = Buffer.concat([PNG, Buffer.from(`khong-co-${Math.random()}`)]);
    expect((await putImage(owner, "00000000-0000-4000-8000-000000000001", odd)).status).toBe(404);
    expect(await readdir(root).catch(() => [] as string[])).toEqual(before);
  });

  it("ảnh: jpg/png/webp nhận; gif và văn bản → 400 image_format; > 2 MB → 413; thay ảnh đổi imageUrl; gỡ → null; tệp protected không gắn được", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const imageUrl = async () => (await list(owner)).categories[0]!.imageUrl;
    for (const bytes of [JPG, WEBP, PNG]) {
      const res = await putImage(owner, a, bytes);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { imageUrl: string }).imageUrl).toBe(await imageUrl());
    }
    expect(await imageUrl()).toMatch(/^\/media\/[0-9a-f]{64}\.png$/);
    for (const bytes of [GIF, Buffer.from("day la van ban, khong phai anh .jpg")]) {
      const res = await putImage(owner, a, bytes);
      expect([res.status, await errorOf(res)]).toEqual([400, "image_format"]);
    }
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const tooBig = await putImage(owner, a, big);
    expect([tooBig.status, await errorOf(tooBig)]).toEqual([413, "image_too_large"]);
    const lied = await putImage(owner, a, PNG, String(3 * 1024 * 1024));
    expect(lied.status).toBe(413);
    expect(await imageUrl()).toMatch(/\.png$/);
    expect((await removeImage(owner, a)).status).toBe(200);
    expect(await imageUrl()).toBeNull();
    const { rows: [prot] } = await sqlAsMigrator(
      `INSERT INTO media_assets (sha256, mime, bytes, visibility, storage_key) VALUES ($1, 'image/png', 10, 'protected', $2) RETURNING id`,
      ["a".repeat(64), `${"a".repeat(64)}.png`],
    );
    await expect(sqlAsMigrator(`UPDATE course_categories SET image_asset_id = $1 WHERE id = $2`, [prot.id, a])).rejects.toThrow(/category_image_not_public/);
  });

  it("mỗi thao tác ghi nhật ký", async () => {
    const ids = await seedContent();
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "A" })).body.id!;
    const b = (await create(owner, { titleVi: "B" })).body.id!;
    await patch(owner, a, { titleVi: "A2" });
    await patch(owner, a, { move: "down" });
    await setCourse(owner, ids.engine_cadet_tanker!, a);
    await putImage(owner, a, PNG);
    await removeImage(owner, a);
    await remove(owner, b);
    expect(await actions()).toEqual([
      "category_create", "category_create", "category_update", "category_move", "course_category_set",
      "category_image_set", "category_image_remove", "category_delete",
    ]);
    const { rows: [img] } = await sqlAsMigrator(`SELECT after FROM admin_audit_log WHERE action = 'category_image_set'`);
    expect(img.after).toMatchObject({ mime: "image/png", bytes: PNG.length });
    expect((img.after as { sha256: string }).sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Dữ liệu ban đầu (Task 4): chỉ tạo, không bao giờ ghi đè thay đổi của chủ.
describe("gieo danh mục theo chức danh (applyCategoryLayout)", () => {
  const T = "engine_cadet_tanker";
  const D = "engine_cadet_dry_cargo";
  async function images() {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { createHash } = await import("node:crypto");
    const dir = await mkdtemp(`${tmpdir()}/rank-`);
    await writeFile(`${dir}/a.png`, PNG);
    await writeFile(`${dir}/b.jpg`, JPG);
    await writeFile(`${dir}/c.gif`, GIF);
    const sha16 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 16);
    return { dir, pngSha: sha16(PNG), jpgSha: sha16(JPG) };
  }
  async function layoutWith() {
    const img = await images();
    return {
      img,
      layout: [
        { seedKey: "rank:a", titleVi: "Thực tập máy", titleEn: "Engine Cadet", imageFile: `${img.dir}/a.png`, imageSha16: img.pngSha, courses: [T] },
        { seedKey: "rank:b", titleVi: "Phụ máy", titleEn: "Wiper", imageFile: `${img.dir}/b.jpg`, imageSha16: img.jpgSha, courses: [D] },
        { seedKey: "rank:c", titleVi: "Thợ máy", titleEn: "Oiler", courses: [] },
      ],
    };
  }
  const state = async () =>
    (await sqlAsMigrator(`
      SELECT c.seed_key, c.title_vi, c.title_en, c.position, c.image_asset_id IS NOT NULL AS has_image,
             coalesce((SELECT array_agg(slug ORDER BY slug) FROM courses WHERE category_id = c.id), '{}') AS courses
      FROM course_categories c ORDER BY c.position`)).rows;

  it("lần đầu tạo đủ danh mục đúng thứ tự, tên, ảnh, gắn khóa; chạy lại không đổi gì", async () => {
    await seedContent();
    const { publish } = await import("../helpers/content");
    await publish(T);
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const ctx = await ownerCtx();
    const { layout } = await layoutWith();
    const first = await applyCategoryLayout(ctx, layout);
    expect(first).toEqual({ created: ["rank:a", "rank:b", "rank:c"], skipped: [], assigned: [T, D], keptAssignment: [], uncategorizedPublished: [] });
    expect(await state()).toEqual([
      { seed_key: "rank:a", title_vi: "Thực tập máy", title_en: "Engine Cadet", position: 1, has_image: true, courses: [T] },
      { seed_key: "rank:b", title_vi: "Phụ máy", title_en: "Wiper", position: 2, has_image: true, courses: [D] },
      { seed_key: "rank:c", title_vi: "Thợ máy", title_en: "Oiler", position: 3, has_image: false, courses: [] },
    ]);
    const snapshot = await state();
    const again = await applyCategoryLayout(ctx, layout);
    expect(again).toMatchObject({ created: [], skipped: ["rank:a", "rank:b", "rank:c"], assigned: [] });
    expect(await state()).toEqual(snapshot);
    expect(await actions()).toEqual(["category_layout_apply", "category_layout_apply"]);
  });

  it("chủ đổi tên/thứ tự/gỡ ảnh/chuyển khóa rồi chạy lại → vẫn giữ thay đổi của chủ", async () => {
    const ids = await seedContent();
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const ctx = await ownerCtx();
    const { layout } = await layoutWith();
    await applyCategoryLayout(ctx, layout);
    const owner = await adminSess("owner");
    const idOf = async (k: string) => (await sqlAsMigrator(`SELECT id FROM course_categories WHERE seed_key = $1`, [k])).rows[0].id as string;
    expect((await patch(owner, await idOf("rank:a"), { titleVi: "Học viên thực tập" })).status).toBe(200);
    expect((await patch(owner, await idOf("rank:c"), { move: "up" })).status).toBe(200);
    expect((await removeImage(owner, await idOf("rank:b"))).status).toBe(200);
    expect((await setCourse(owner, ids[T]!, await idOf("rank:c"))).status).toBe(200);
    expect((await setCourse(owner, ids[D]!, null)).status).toBe(200);
    const snapshot = await state();
    const again = await applyCategoryLayout(ctx, layout);
    expect(again.created).toEqual([]);
    expect(again.assigned).toEqual([]);
    expect(again.keptAssignment).toEqual([T, D]);
    expect(await state()).toEqual(snapshot);
  });

  it("chủ xóa danh mục đã gieo rồi chạy lại → không tạo lại; ảnh của danh mục bị bỏ qua không cần còn trên đĩa", async () => {
    const ids = await seedContent();
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const ctx = await ownerCtx();
    const { layout } = await layoutWith();
    await applyCategoryLayout(ctx, layout);
    const owner = await adminSess("owner");
    const idA = (await sqlAsMigrator(`SELECT id FROM course_categories WHERE seed_key = 'rank:a'`)).rows[0].id as string;
    expect((await setCourse(owner, ids[T]!, null)).status).toBe(200);
    expect((await remove(owner, idA)).status).toBe(200);
    const snapshot = await state();
    const again = await applyCategoryLayout(ctx, layout.map((e) => ({ ...e, imageFile: e.imageFile ? `${e.imageFile}.mat` : undefined })));
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual(["rank:a", "rank:b", "rank:c"]);
    expect(again.keptAssignment).toContain(T);
    expect(await state()).toEqual(snapshot);
  });

  it("trùng tên với danh mục chủ tự tạo → lỗi category_name_taken, không ghi gì", async () => {
    await seedContent();
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const owner = await adminSess("owner");
    await create(owner, { titleVi: "Thợ máy" });
    const snapshot = await state();
    const { layout } = await layoutWith();
    await expect(applyCategoryLayout(await ownerCtx(), layout)).rejects.toThrow(/category_name_taken/);
    expect(await state()).toEqual(snapshot);
  });

  it("slug không tồn tại → ném lỗi, không ghi gì; ảnh sai sha hoặc sai định dạng → ném lỗi", async () => {
    await seedContent();
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const ctx = await ownerCtx();
    const { layout, img } = await layoutWith();
    await expect(applyCategoryLayout(ctx, [...layout, { seedKey: "rank:x", titleVi: "X", titleEn: "X", courses: ["khong_co"] }])).rejects.toThrow(/khong_co/);
    await expect(applyCategoryLayout(ctx, [{ ...layout[0]!, imageSha16: "0000000000000000" }])).rejects.toThrow(/sha256/);
    await expect(applyCategoryLayout(ctx, [{ ...layout[0]!, imageFile: `${img.dir}/c.gif`, imageSha16: undefined }])).rejects.toThrow(/image_format/);
    expect(await state()).toEqual([]);
    expect(await actions()).toEqual([]);
  });

  it("khóa đang bán chưa có danh mục được liệt kê trong uncategorizedPublished", async () => {
    await seedContent();
    const { publish } = await import("../helpers/content");
    await publish(T);
    await publish(D);
    const { applyCategoryLayout } = await import("@/modules/content/categories");
    const { ownerCtx } = await import("../helpers/admin");
    const r = await applyCategoryLayout(await ownerCtx(), [{ seedKey: "rank:a", titleVi: "A", titleEn: "A", courses: [T] }]);
    expect(r.uncategorizedPublished).toEqual([D]);
    const { rows } = await sqlAsMigrator(`SELECT url_slug FROM course_categories WHERE seed_key = 'rank:a'`);
    expect(rows).toEqual([{ url_slug: "a" }]);
  });
});

describe("đường dẫn danh mục (url_slug)", () => {
  const slugOf = async (s: AdminSess, id: string) => (await list(s)).categories.find((c) => c.id === id)!.urlSlug;

  it("tạo: theo tên tiếng Việt, một không gian phẳng cho cả danh mục con; trùng thì -2; 'Khác' không lấy được 'khac'", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "Máy ba" })).body.id!;
    await create(owner, { titleVi: "Máy ba", parentId: a });
    await create(owner, { titleVi: "Khác" });
    const { categories } = await list(owner);
    expect(categories.map((c) => [c.titleVi, c.parentId === null, c.urlSlug])).toEqual([
      ["Máy ba", true, "may-ba"], ["Máy ba", false, "may-ba-2"], ["Khác", true, "khac-2"],
    ]);
  });

  it("chủ sửa đường dẫn: chữ có dấu được chuẩn hóa, trùng hay 'khac' → 409, không còn chữ → 400; ghi audit; support → 403", async () => {
    const owner = await adminSess("owner");
    const a = (await create(owner, { titleVi: "Thợ máy" })).body.id!;
    const b = (await create(owner, { titleVi: "Máy hai" })).body.id!;
    expect((await patch(owner, a, { urlSlug: " Thợ Máy Oiler " })).status).toBe(200);
    expect(await slugOf(owner, a)).toBe("tho-may-oiler");
    const taken = await patch(owner, b, { urlSlug: "tho-may-oiler" });
    expect([taken.status, await errorOf(taken)]).toEqual([409, "url_slug_taken"]);
    const other = await patch(owner, b, { urlSlug: "khac" });
    expect([other.status, await errorOf(other)]).toEqual([409, "url_slug_taken"]);
    const empty = await patch(owner, b, { urlSlug: "!!!" });
    expect([empty.status, await errorOf(empty)]).toEqual([400, "url_slug_invalid"]);
    expect(await slugOf(owner, b)).toBe("may-hai");
    const { rows } = await sqlAsMigrator(`SELECT before, after FROM admin_audit_log WHERE action = 'category_update' AND target_id = $1`, [a]);
    expect(rows).toEqual([{ before: expect.objectContaining({ urlSlug: "tho-may" }), after: expect.objectContaining({ urlSlug: "tho-may-oiler" }) }]);
    const support = await adminSess("support");
    expect((await patch(support, b, { urlSlug: "may-2" })).status).toBe(403);
  });
});
