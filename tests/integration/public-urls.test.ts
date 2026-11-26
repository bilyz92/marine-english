import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { routePublicPath } from "@/modules/content/public-urls";
import { updateCourse } from "@/modules/content/catalog";
import { HttpError } from "@/lib/http";
import { ownerCtx } from "../helpers/admin";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

// Đường dẫn công khai đọc được + 404 thật (SEO, chủ 26/11/2026). Trang dựng theo luồng (Cache Components) nên mã 404/308 phải quyết ở
// proxy, trước khi trang chạy: routePublicPath là phần quyết định đó.

const T = "engine_cadet_tanker";
const T_URL = "thuc-tap-sinh-may-tau-dau-va-hoa-chat";
const D = "engine_cadet_dry_cargo";
const D_URL = "thuc-tap-sinh-may-tau-hang-kho";

const route = (path: string) => {
  const u = new URL(path, "http://x");
  return routePublicPath(u.pathname, u.search);
};

async function category(title: string, urlSlug: string, parent: string | null = null) {
  const { rows: [r] } = await sqlAsMigrator(
    `INSERT INTO course_categories (parent_id, title_vi, position, url_slug)
     VALUES ($1, $2, (SELECT coalesce(max(position), 0) + 1 FROM course_categories WHERE parent_key = coalesce($1::uuid, '00000000-0000-0000-0000-000000000000')), $3)
     RETURNING id::text AS id`,
    [parent, title, urlSlug],
  );
  return r.id as string;
}

describe("đường dẫn khóa công khai", () => {
  it("khóa đang bán: đường dẫn đọc được → hiện; mã nội bộ → chuyển hướng vĩnh viễn (giữ tham số); không có → 404", async () => {
    await seedContent();
    await publish(T);
    expect(await route(`/khoa-hoc/${T_URL}`)).toEqual({ kind: "ok" });
    expect(await route(`/khoa-hoc/${T}`)).toEqual({ kind: "redirect", to: `/khoa-hoc/${T_URL}` });
    expect(await route(`/khoa-hoc/${T}?utm_source=zalo`)).toEqual({ kind: "redirect", to: `/khoa-hoc/${T_URL}?utm_source=zalo` });
    expect(await route("/khoa-hoc/khong-co-that")).toEqual({ kind: "not_found" });
    expect(await route("/khoa-hoc/danh-muc")).toEqual({ kind: "not_found" });
  });

  it("khóa nháp hay sắp ra mắt (archived): 404 theo cả đường dẫn đọc được lẫn mã nội bộ", async () => {
    await seedContent();
    await publish(D);
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = $1`, [D]);
    for (const p of [`/khoa-hoc/${T}`, `/khoa-hoc/${T_URL}`, `/khoa-hoc/${D}`, `/khoa-hoc/${D_URL}`, `/khoa-hoc/${D_URL}/hoc-thu/1`]) {
      expect([p, await route(p)]).toEqual([p, { kind: "not_found" }]);
    }
  });

  it("bài học thử: chỉ vị trí là bài thử mới hiện; vị trí khác, '01', chữ → 404; mã nội bộ → chuyển hướng tới đúng bài", async () => {
    await seedContent();
    await publish(T);
    expect(await route(`/khoa-hoc/${T_URL}/hoc-thu/1`)).toEqual({ kind: "ok" });
    expect(await route(`/khoa-hoc/${T_URL}/hoc-thu/2`)).toEqual({ kind: "ok" });
    for (const n of ["3", "9", "01", "0", "a", "1e1"]) expect([n, await route(`/khoa-hoc/${T_URL}/hoc-thu/${n}`)]).toEqual([n, { kind: "not_found" }]);
    expect(await route(`/khoa-hoc/${T}/hoc-thu/2`)).toEqual({ kind: "redirect", to: `/khoa-hoc/${T_URL}/hoc-thu/2` });
    expect(await route(`/khoa-hoc/${T}/hoc-thu/9`)).toEqual({ kind: "not_found" });
  });

  it("đường dẫn khác dưới khóa (ảnh chia sẻ) và trang ngoài /khoa-hoc: proxy không quyết", async () => {
    expect(await route(`/khoa-hoc/${T_URL}/opengraph-image`)).toBeNull();
    expect(await route("/khoa-hoc")).toBeNull();
    expect(await route("/khoa-hoc?tim=1")).toBeNull();
    expect(await route("/gioi-thieu")).toBeNull();
  });

  it("chủ đổi đường dẫn: đường dẫn mới hiện, đường dẫn cũ chuyển hướng mãi; khóa khác không lấy được đường dẫn cũ; audit", async () => {
    const ids = await seedContent();
    await publish(T);
    await publish(D);
    const ctx = await ownerCtx();
    expect(await updateCourse(ctx, ids[T]!, { urlSlug: "Khóa tàu dầu" })).toBe("ok");
    expect(await route("/khoa-hoc/khoa-tau-dau")).toEqual({ kind: "ok" });
    expect(await route(`/khoa-hoc/${T_URL}`)).toEqual({ kind: "redirect", to: "/khoa-hoc/khoa-tau-dau" });
    expect(await updateCourse(ctx, ids[T]!, { urlSlug: "tau-dau" })).toBe("ok");
    expect(await route(`/khoa-hoc/${T_URL}`)).toEqual({ kind: "redirect", to: "/khoa-hoc/tau-dau" });
    expect(await route("/khoa-hoc/khoa-tau-dau/hoc-thu/1")).toEqual({ kind: "redirect", to: "/khoa-hoc/tau-dau/hoc-thu/1" });
    // Đường dẫn cũ, hiện tại của khóa khác và chữ dành riêng đều đã có chủ (mã nội bộ có "_" không bao giờ là đường dẫn).
    for (const taken of [T_URL, "khoa-tau-dau", "tau-dau", "danh-muc"]) {
      await expect(updateCourse(ctx, ids[D]!, { urlSlug: taken })).rejects.toThrow(HttpError);
    }
    await expect(updateCourse(ctx, ids[D]!, { urlSlug: "!!!" })).rejects.toMatchObject({ status: 400 });
    // Lấy lại đường dẫn cũ của chính mình thì được.
    expect(await updateCourse(ctx, ids[T]!, { urlSlug: T_URL })).toBe("ok");
    expect(await route("/khoa-hoc/tau-dau")).toEqual({ kind: "redirect", to: `/khoa-hoc/${T_URL}` });
    const { rows } = await sqlAsMigrator(
      `SELECT before ->> 'urlSlug' AS b, after ->> 'urlSlug' AS a FROM admin_audit_log WHERE action = 'course_update' AND target_id = $1 ORDER BY at`, [ids[T]]);
    expect(rows.map((r) => [r.b, r.a])).toEqual([[T_URL, "khoa-tau-dau"], ["khoa-tau-dau", "tau-dau"], ["tau-dau", T_URL]]);
  });
});

describe("đường dẫn danh mục công khai", () => {
  it("/khoa-hoc/danh-muc/<đường dẫn>: danh mục và danh mục con có khóa hiện được; danh mục rỗng hay không có → 404; 'khac' khi có khóa chưa xếp", async () => {
    const ids = await seedContent();
    await publish(T);
    const rank = await category("Thợ máy", "tho-may");
    const sub = await category("Tàu dầu", "tau-dau", rank);
    await category("Rỗng", "rong");
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE id = $2`, [sub, ids[T]]);
    expect(await route("/khoa-hoc/danh-muc/tho-may")).toEqual({ kind: "ok" });
    expect(await route("/khoa-hoc/danh-muc/tau-dau")).toEqual({ kind: "ok" });
    expect(await route("/khoa-hoc/danh-muc/rong")).toEqual({ kind: "not_found" });
    expect(await route("/khoa-hoc/danh-muc/khong-co")).toEqual({ kind: "not_found" });
    expect(await route("/khoa-hoc/danh-muc/khac")).toEqual({ kind: "not_found" });
    expect(await route("/khoa-hoc/danh-muc/tho-may/them")).toBeNull(); // không có route: Next tự trả 404
    // Khóa sắp ra mắt chưa có danh mục vẫn hiện ở "Khóa khác" như trên /khoa-hoc.
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = $1`, [D]);
    expect(await route("/khoa-hoc/danh-muc/khac")).toEqual({ kind: "ok" });
  });

  it("?dm=<id> cũ chuyển hướng vĩnh viễn tới đường dẫn mới; ?dm=khac → /khoa-hoc/danh-muc/khac; dm lạ → /khoa-hoc; giữ tham số khác", async () => {
    await seedContent();
    const rank = await category("Thợ máy", "tho-may");
    expect(await route(`/khoa-hoc?dm=${rank}`)).toEqual({ kind: "redirect", to: "/khoa-hoc/danh-muc/tho-may" });
    expect(await route("/khoa-hoc?dm=khac&tim=1")).toEqual({ kind: "redirect", to: "/khoa-hoc/danh-muc/khac?tim=1" });
    expect(await route("/khoa-hoc?dm=00000000-0000-4000-8000-000000000001")).toEqual({ kind: "redirect", to: "/khoa-hoc" });
    expect(await route("/khoa-hoc?dm=khong-phai-uuid")).toEqual({ kind: "redirect", to: "/khoa-hoc" });
  });
});

describe("proxy: mã HTTP thật", () => {
  const req = (path: string) => new NextRequest(`${process.env.APP_ORIGIN}${path}`);

  it("308 tới đường dẫn mới; 404 viết lại sang trang không tìm thấy; trang đúng thì đi tiếp", async () => {
    await seedContent();
    await publish(T);
    const moved = await proxy(req(`/khoa-hoc/${T}`));
    expect([moved.status, moved.headers.get("location")]).toEqual([308, `${process.env.APP_ORIGIN}/khoa-hoc/${T_URL}`]);
    const missing = await proxy(req("/khoa-hoc/khong-co-that"));
    expect(missing.headers.get("x-middleware-rewrite")).toMatch(/\/_khong-tim-thay$/);
    const ok = await proxy(req(`/khoa-hoc/${T_URL}`));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
  });

  it("bài viết: bài có trong content/bai-viet đi tiếp; đường dẫn không có bài → 404", async () => {
    expect((await proxy(req("/bai-viet/cau-hoi-phong-van-engine-cadet"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/bai-viet"))).headers.get("x-middleware-next")).toBe("1");
    expect((await proxy(req("/bai-viet/khong-co"))).headers.get("x-middleware-rewrite")).toMatch(/\/_khong-tim-thay$/);
  });
});
