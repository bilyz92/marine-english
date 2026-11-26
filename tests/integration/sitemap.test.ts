import { describe, expect, it, vi } from "vitest";

// connection() chỉ chạy được trong một yêu cầu của Next; ngoài đó (vitest) coi như đã có yêu cầu.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import sitemap from "@/app/sitemap";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

const ORIGIN = process.env.APP_ORIGIN!.replace(/\/$/, "");

describe("sitemap.xml", () => {
  it("trang công khai + khóa đang bán + bài học thử + danh mục có khóa đang bán, đường dẫn đọc được, địa chỉ tuyệt đối theo APP_ORIGIN; không có khóa nháp, sắp ra mắt hay trang riêng tư", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    // Khóa 'archived' hiện là "Sắp ra mắt": không mua, không học thử được nên không vào sitemap.
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = 'engine_cadet_dry_cargo'`);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toEqual([
      `${ORIGIN}/`,
      `${ORIGIN}/khoa-hoc`,
      `${ORIGIN}/gioi-thieu`,
      `${ORIGIN}/lien-he`,
      `${ORIGIN}/bai-viet`,
      `${ORIGIN}/chinh-sach`,
      `${ORIGIN}/khoa-hoc/thuc-tap-sinh-may-tau-dau-va-hoa-chat`,
      `${ORIGIN}/khoa-hoc/thuc-tap-sinh-may-tau-dau-va-hoa-chat/hoc-thu/1`,
      `${ORIGIN}/khoa-hoc/thuc-tap-sinh-may-tau-dau-va-hoa-chat/hoc-thu/2`,
      // Cả hai khóa chưa xếp danh mục: nhóm "Khóa khác" có khóa đang bán.
      `${ORIGIN}/khoa-hoc/danh-muc/khac`,
      `${ORIGIN}/bai-viet/cau-hoi-phong-van-engine-cadet`,
    ]);
    for (const u of urls) expect(u).not.toMatch(/\/(mua|thanh-toan|don-hang|dang-nhap|tai-khoan|hoc\b|admin|api)(\/|$)/);
  });

  it("danh mục và danh mục con có khóa đang bán thì vào sitemap; danh mục chỉ có khóa sắp ra mắt thì không", async () => {
    const ids = await seedContent();
    await publish("engine_cadet_tanker");
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = 'engine_cadet_dry_cargo'`);
    const add = async (title: string, slug: string, position: number, parent: string | null = null) =>
      (await sqlAsMigrator(`INSERT INTO course_categories (parent_id, title_vi, position, url_slug) VALUES ($1, $2, $3, $4) RETURNING id::text AS id`, [parent, title, position, slug])).rows[0].id as string;
    const rank = await add("Thực tập máy", "thuc-tap-may", 1);
    const sub = await add("Tàu dầu", "tau-dau", 1, rank);
    const soon = await add("Máy hai", "may-hai", 2);
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE id = $2`, [sub, ids.engine_cadet_tanker]);
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE id = $2`, [soon, ids.engine_cadet_dry_cargo]);
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls).toContain(`${ORIGIN}/khoa-hoc/danh-muc/thuc-tap-may`);
    expect(urls).toContain(`${ORIGIN}/khoa-hoc/danh-muc/tau-dau`);
    expect(urls).not.toContain(`${ORIGIN}/khoa-hoc/danh-muc/may-hai`);
    expect(urls).not.toContain(`${ORIGIN}/khoa-hoc/danh-muc/khac`);
  });

  it("chưa có khóa nào đang bán: chỉ các trang tĩnh và bài viết", async () => {
    await seedContent();
    expect((await sitemap()).map((e) => e.url)).toEqual([
      `${ORIGIN}/`, `${ORIGIN}/khoa-hoc`, `${ORIGIN}/gioi-thieu`, `${ORIGIN}/lien-he`, `${ORIGIN}/bai-viet`, `${ORIGIN}/chinh-sach`,
      `${ORIGIN}/bai-viet/cau-hoi-phong-van-engine-cadet`,
    ]);
  });
});
