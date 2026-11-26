import { describe, expect, it } from "vitest";
import { isUrlSlug, slugify, URL_SLUG_MAX, withSuffix } from "@/modules/content/url-slug";

describe("slugify: đường dẫn đọc được từ tên tiếng Việt", () => {
  it("bỏ dấu, đ → d, chữ thường, ký tự khác chữ số thành một dấu gạch", () => {
    expect(slugify("Luyện phỏng vấn Engine Cadet")).toBe("luyen-phong-van-engine-cadet");
    expect(slugify("Đại phó & Máy trưởng (2/E)")).toBe("dai-pho-may-truong-2-e");
    expect(slugify("  Tàu dầu — Tanker!!  ")).toBe("tau-dau-tanker");
    expect(slugify("Ưu tiên: Ở ĐÂY, ỨNG Viên")).toBe("uu-tien-o-day-ung-vien");
  });

  it("chuỗi soạn kiểu tổ hợp (NFD) cho cùng kết quả như dựng sẵn (NFC)", () => {
    const nfd = "Thợ máy".normalize("NFD");
    expect(slugify(nfd)).toBe("tho-may");
  });

  it("không còn chữ hay số nào thì trả chuỗi rỗng (người gọi chọn tên thay)", () => {
    expect(slugify("!!! — ???")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("dài quá thì cắt về tối đa 80 ký tự, không để gạch ở cuối", () => {
    const s = slugify(`${"abcdefghi ".repeat(12)}`);
    expect(s.length).toBeLessThanOrEqual(URL_SLUG_MAX);
    expect(s).not.toMatch(/-$/);
    expect(isUrlSlug(s)).toBe(true);
  });

  it("hậu tố số khi trùng vẫn giữ trong 80 ký tự", () => {
    expect(withSuffix("tau-dau", 2)).toBe("tau-dau-2");
    const long = "a".repeat(79) + "b";
    expect(withSuffix(long, 12)).toHaveLength(URL_SLUG_MAX);
    expect(withSuffix(long, 12).endsWith("-12")).toBe(true);
    expect(withSuffix(`${"a".repeat(77)}-bc`, 3)).toBe(`${"a".repeat(77)}-3`);
  });

  it("isUrlSlug: chỉ chữ thường không dấu, số, gạch đơn giữa các phần, tối đa 80", () => {
    for (const ok of ["a", "khoa-1", "luyen-phong-van-engine-cadet"]) expect(isUrlSlug(ok)).toBe(true);
    for (const bad of ["", "-a", "a-", "a--b", "A", "mea_cadet_interview", "tàu", "a".repeat(81)]) expect(isUrlSlug(bad)).toBe(false);
  });
});
