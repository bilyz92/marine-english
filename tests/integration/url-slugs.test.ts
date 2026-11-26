import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { slugify } from "@/modules/content/url-slug";
import { newSchemaName } from "../helpers/db";
import { errCode, pgAs } from "../helpers/pg";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

const MIGRATIONS = path.resolve(__dirname, "../../prisma/migrations");
const THIS = "20261127090000_readable_urls";

/** Dựng một schema riêng tới trước migration này, cho chạy `seed`, rồi chạy migration: kiểm phần điền dữ liệu cũ. */
async function migrateWithOldData(seed: (c: Client) => Promise<void>): Promise<Client> {
  const schema = newSchemaName();
  const c = new Client({ connectionString: process.env.MIGRATOR_DATABASE_URL });
  await c.connect();
  await c.query(`CREATE SCHEMA "${schema}"`);
  await c.query(`SET search_path TO "${schema}"`);
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const dir of dirs.filter((d) => d < THIS)) await c.query(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8"));
  await seed(c);
  await c.query(readFileSync(path.join(MIGRATIONS, THIS, "migration.sql"), "utf8"));
  return Object.assign(c, { schema });
}

async function drop(c: Client & { schema?: string }) {
  await c.query(`DROP SCHEMA "${c.schema}" CASCADE`);
  await c.end();
}

describe("đường dẫn đọc được: migration", () => {
  it("điền url_slug từ tên tiếng Việt; trùng thì -2, -3; tránh mã nội bộ của khóa khác và chữ dành riêng", async () => {
    const c = await migrateWithOldData(async (db) => {
      const add = (slug: string, title: string, at: string) =>
        db.query(`INSERT INTO courses (slug, title_vi, title_en, created_at) VALUES ($1, $2, 'x', $3)`, [slug, title, at]);
      await add("mea_cadet_interview", "Luyện phỏng vấn Engine Cadet", "2026-11-01");
      await add("mea_cadet_interview_2", "Luyện phỏng vấn  Engine Cadet!", "2026-11-02");
      await add("tau-dau", "Khóa A", "2026-11-03"); // mã nội bộ trùng đường dẫn khóa sau
      await add("khoa_b", "Tàu dầu", "2026-11-04");
      await add("khoa_c", "Danh mục", "2026-11-05");
      await add("khoa_d", "???", "2026-11-06");
      const cat = async (title: string, position: number, parent: string | null = null) =>
        (await db.query(`INSERT INTO course_categories (parent_id, title_vi, position) VALUES ($1, $2, $3) RETURNING id`, [parent, title, position])).rows[0].id as string;
      const thoMay = await cat("Thợ máy", 1);
      await cat("Khác", 2);
      await cat("Tàu dầu", 1, thoMay);
      await cat("Tàu  dầu", 3);
    });
    try {
      const courses = (await c.query(`SELECT slug, url_slug FROM courses ORDER BY created_at`)).rows.map((r) => [r.slug, r.url_slug]);
      expect(courses).toEqual([
        ["mea_cadet_interview", "luyen-phong-van-engine-cadet"],
        ["mea_cadet_interview_2", "luyen-phong-van-engine-cadet-2"],
        ["tau-dau", "khoa-a"],
        ["khoa_b", "tau-dau-2"],
        ["khoa_c", "danh-muc-2"],
        ["khoa_d", "khoa-hoc"],
      ]);
      const cats = (await c.query(`SELECT title_vi, url_slug FROM course_categories ORDER BY url_slug`)).rows.map((r) => [r.title_vi, r.url_slug]);
      // Danh mục cấp 1 chọn trước danh mục con: "Tàu  dầu" (cấp 1) giữ tau-dau, danh mục con cùng tên nhận tau-dau-2.
      expect(cats).toEqual([["Khác", "khac-2"], ["Tàu  dầu", "tau-dau"], ["Tàu dầu", "tau-dau-2"], ["Thợ máy", "tho-may"]]);
    } finally {
      await drop(c);
    }
  });

  it("slugify_vi trong DB cho cùng kết quả với slugify() của app", async () => {
    const titles = [
      "Luyện phỏng vấn Engine Cadet", "Thực tập sinh máy tàu dầu và hóa chất", "Đại phó & Máy trưởng (2/E)", "ƯU TIÊN Ở ĐÂY",
      "Sĩ quan máy 3/E – Tàu container", "Ngữ pháp: Thì hiện tại đơn", "Ống, van, bơm!", "Thợ máy".normalize("NFD"), "Crème brûlée ñ ç",
      "x".repeat(100), "!!!", "Ỷ Ỹ Ỵ ỳ",
    ];
    const migrator = await pgAs("migrator");
    try {
      for (const t of titles) {
        const { rows: [r] } = await migrator.query(`SELECT slugify_vi($1) AS s`, [t]);
        expect([t, r.s]).toEqual([t, slugify(t)]);
      }
    } finally {
      await migrator.end();
    }
  });

  it("ràng buộc: đúng mẫu, ≤ 80 ký tự, không 'danh-muc' (khóa) hay 'khac' (danh mục), không trùng", async () => {
    await seedContent();
    const m = await pgAs("migrator");
    try {
      for (const bad of ["Co-Dau", "a--b", "-a", "danh-muc", "a".repeat(81)]) {
        expect([bad, await errCode(m, `UPDATE courses SET url_slug = $1 WHERE slug = 'engine_cadet_tanker'`, [bad])]).toEqual([bad, "23514"]);
      }
      const { rows: [other] } = await m.query(`SELECT url_slug FROM courses WHERE slug = 'engine_cadet_dry_cargo'`);
      expect(await errCode(m, `UPDATE courses SET url_slug = $1 WHERE slug = 'engine_cadet_tanker'`, [other.url_slug])).toBe("23505");
      expect(await errCode(m, `INSERT INTO course_categories (title_vi, position, url_slug) VALUES ('Khác', 1, 'khac')`)).toBe("23514");
    } finally {
      await m.end();
    }
  });

  it("me_app: sửa được url_slug khóa, thêm được đường dẫn cũ; không sửa/xóa đường dẫn cũ", async () => {
    const ids = await seedContent();
    const app = await pgAs("app");
    try {
      expect(await errCode(app, `UPDATE courses SET url_slug = 'moi' WHERE slug = 'engine_cadet_tanker'`)).toBeNull();
      expect(await errCode(app, `INSERT INTO course_url_slug_history (url_slug, course_id) VALUES ('cu', $1)`, [ids.engine_cadet_tanker])).toBeNull();
      expect(await errCode(app, `UPDATE course_url_slug_history SET url_slug = 'khac-nua'`)).toBe("42501");
      expect(await errCode(app, `DELETE FROM course_url_slug_history`)).toBe("42501");
    } finally {
      await app.end();
    }
  });
});

describe("đường dẫn đọc được: khóa và danh mục mới", () => {
  it("mã nội bộ của khóa mới không được trùng đường dẫn hiện tại hay đường dẫn cũ của khóa khác (không cướp link đã chia sẻ)", async () => {
    const ids = await seedContent();
    await sqlAsMigrator(`UPDATE courses SET url_slug = 'tauhang' WHERE slug = 'engine_cadet_dry_cargo'`);
    await sqlAsMigrator(`INSERT INTO course_url_slug_history (url_slug, course_id) VALUES ('taudau', $1)`, [ids.engine_cadet_tanker]);
    const { createCourse } = await import("@/modules/content/editor");
    const { ownerCtx } = await import("../helpers/admin");
    const ctx = await ownerCtx();
    for (const slug of ["tauhang", "taudau"]) {
      await expect(createCourse(ctx, { slug, titleVi: "Khóa", titleEn: "C" })).rejects.toMatchObject({ status: 409, message: "slug_taken" });
    }
    const { importContent } = await import("@/worker/content-import");
    const data = JSON.parse(readFileSync("tests/fixtures/content-mini.json", "utf8"));
    data.courses[0].id = "taudau";
    const client = await pgAs("migrator");
    try {
      await expect(importContent(client, data)).rejects.toThrow(/taudau/);
    } finally {
      await client.end();
    }
  });

  it("bộ nhập học liệu đặt url_slug theo tên tiếng Việt; nhập lại không đổi đường dẫn chủ đã sửa", async () => {
    await seedContent();
    const { rows } = await sqlAsMigrator(`SELECT slug, url_slug FROM courses ORDER BY slug`);
    expect(rows.map((r) => [r.slug, r.url_slug])).toEqual([
      ["engine_cadet_dry_cargo", "thuc-tap-sinh-may-tau-hang-kho"],
      ["engine_cadet_tanker", "thuc-tap-sinh-may-tau-dau-va-hoa-chat"],
    ]);
    await sqlAsMigrator(`UPDATE courses SET url_slug = 'khoa-tau-dau' WHERE slug = 'engine_cadet_tanker'`);
    await seedContent();
    await publish("engine_cadet_tanker");
    const { rows: [after] } = await sqlAsMigrator(`SELECT url_slug FROM courses WHERE slug = 'engine_cadet_tanker'`);
    expect(after.url_slug).toBe("khoa-tau-dau");
  });
});
