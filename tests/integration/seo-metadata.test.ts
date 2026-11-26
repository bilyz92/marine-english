import { describe, expect, it, vi } from "vitest";

// connection() chỉ chạy được trong một yêu cầu của Next; ngoài đó (vitest) coi như đã có yêu cầu.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { generateMetadata as courseMetadata } from "@/app/(site)/khoa-hoc/[slug]/page";
import { generateMetadata as trialMetadata } from "@/app/(site)/khoa-hoc/[slug]/hoc-thu/[position]/page";
import { publish, seedContent } from "../helpers/content";
import { sqlAsMigrator } from "../helpers/otp";

// Trang khóa nhận đường dẫn công khai (url_slug, điền từ tên tiếng Việt); mã nội bộ được proxy chuyển hướng trước khi tới trang.
const T_URL = "thuc-tap-sinh-may-tau-dau-va-hoa-chat";
const courseProps = (slug: string) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }) as Parameters<typeof courseMetadata>[0];
const trialProps = (slug: string, position: string) =>
  ({ params: Promise.resolve({ slug, position }), searchParams: Promise.resolve({}) }) as Parameters<typeof trialMetadata>[0];

describe("metadata trang khóa và bài học thử", () => {
  it("khóa đang bán: tiêu đề là tên khóa, mô tả từ dữ liệu thật (≤160 ký tự), canonical sạch, ảnh chia sẻ riêng của khóa", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const m = await courseMetadata(courseProps(T_URL));
    expect(m.title).toMatch(/\S/);
    expect(m.alternates?.canonical).toBe(`/khoa-hoc/${T_URL}`);
    expect(String(m.description)).toContain("4 bài");
    expect(String(m.description).length).toBeLessThanOrEqual(160);
    expect(m.openGraph).not.toHaveProperty("images");
  });

  it("khóa có danh mục con: mô tả ghi chức danh cha và danh mục (đối tượng học)", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const { rows: [parent] } = await sqlAsMigrator(`INSERT INTO course_categories (title_vi, title_en, position, url_slug) VALUES ('Thực tập máy', 'Engine Cadet', 1, 'thuc-tap-may') RETURNING id`);
    const { rows: [child] } = await sqlAsMigrator(`INSERT INTO course_categories (parent_id, title_vi, position, url_slug) VALUES ($1, 'Tàu dầu', 1, 'tau-dau') RETURNING id`, [parent.id]);
    await sqlAsMigrator(`UPDATE courses SET category_id = $1 WHERE slug = 'engine_cadet_tanker'`, [child.id]);
    const m = await courseMetadata(courseProps(T_URL));
    expect(String(m.description)).toContain("dành cho Engine Cadet – Thực tập máy · Tàu dầu");
  });

  it("khóa nháp hay không có: không trả tiêu đề hay mô tả nào (trang báo 404 như cũ)", async () => {
    await seedContent();
    expect(await courseMetadata(courseProps(T_URL))).toEqual({});
    expect(await courseMetadata(courseProps("khong_co"))).toEqual({});
    expect(await trialMetadata(trialProps(T_URL, "1"))).toEqual({});
  });

  it("bài học thử: tiêu đề có số bài và tên khóa, canonical về đúng bài; bài không phải bài thử thì không có gì", async () => {
    await seedContent();
    await publish("engine_cadet_tanker");
    const m = await trialMetadata(trialProps(T_URL, "1"));
    expect(String(m.title)).toMatch(/^Học thử bài 1: /);
    expect(m.alternates?.canonical).toBe(`/khoa-hoc/${T_URL}/hoc-thu/1`);
    expect(String(m.description)).toMatch(/Hãy giới thiệu/);
    expect(await trialMetadata(trialProps(T_URL, "3"))).toEqual({});
  });
});
