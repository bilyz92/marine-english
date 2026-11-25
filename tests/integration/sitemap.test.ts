import { describe, expect, it, vi } from "vitest";

// connection() chỉ chạy được trong một yêu cầu của Next; ngoài đó (vitest) coi như đã có yêu cầu.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import sitemap from "@/app/sitemap";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

const ORIGIN = process.env.APP_ORIGIN!.replace(/\/$/, "");

describe("sitemap.xml", () => {
  it("trang công khai + khóa đang bán + bài học thử, địa chỉ tuyệt đối theo APP_ORIGIN; không có khóa nháp, sắp ra mắt hay trang riêng tư", async () => {
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
      `${ORIGIN}/chinh-sach`,
      `${ORIGIN}/khoa-hoc/engine_cadet_tanker`,
      `${ORIGIN}/khoa-hoc/engine_cadet_tanker/hoc-thu/1`,
      `${ORIGIN}/khoa-hoc/engine_cadet_tanker/hoc-thu/2`,
    ]);
    for (const u of urls) expect(u).not.toMatch(/\/(mua|thanh-toan|don-hang|dang-nhap|tai-khoan|hoc\b|admin|api)(\/|$)/);
  });

  it("chưa có khóa nào đang bán: chỉ các trang tĩnh", async () => {
    await seedContent();
    expect((await sitemap()).map((e) => e.url)).toHaveLength(5);
  });
});
