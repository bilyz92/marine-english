import { describe, expect, it } from "vitest";
import { matchesCourse } from "@/lib/client/course-search";

const tanker = { titleVi: "Thực tập sinh máy tàu dầu và hóa chất", titleEn: "Engine Cadet Tankers" };

describe("tìm khóa học", () => {
  it("không phân biệt hoa thường, có dấu hay không dấu, tiếng Anh hay Việt", () => {
    for (const q of ["tau dau", "TÀU DẦU", "tankers", "cadet", "  thuc tap  ", "hóa chất"]) expect(matchesCourse(tanker, q)).toBe(true);
  });
  it("mọi từ đều phải khớp; ô trống thì khớp hết", () => {
    expect(matchesCourse(tanker, "tau container")).toBe(false);
    expect(matchesCourse(tanker, "")).toBe(true);
    expect(matchesCourse(tanker, "đ")).toBe(true);
  });
});
