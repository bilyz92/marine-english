import { describe, expect, it } from "vitest";
import { courseCardAction, matchesCourse } from "@/lib/client/course-search";

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

describe("tìm theo danh mục (docs/superpowers/plans/2026-11-14-course-categories.md, Task 3)", () => {
  const course = {
    titleVi: "Phỏng vấn tàu dầu", titleEn: "Tanker interview",
    category: { id: "c1", titleVi: "Nhóm thử", titleEn: "Test group", parentTitleVi: "Sĩ quan vận hành", parentTitleEn: "Fitter" },
  };
  it("từ chỉ có trong tên danh mục, danh mục cha, kể cả tên tiếng Anh, vẫn ra khóa", () => {
    for (const q of ["vận hành", "nhom thu", "fitter", "test group", "fitter tanker"]) expect(matchesCourse(course, q)).toBe(true);
    expect(matchesCourse(course, "container")).toBe(false);
  });
  it("khóa chưa có danh mục vẫn tìm như cũ", () => {
    expect(matchesCourse({ ...course, category: null }, "fitter")).toBe(false);
    expect(matchesCourse({ ...course, category: null }, "tanker")).toBe(true);
  });
});

describe("nút trên thẻ khóa học (chủ yêu cầu 04/11/2026)", () => {
  it("khách chưa đăng nhập → Mua khóa", () => {
    expect(courseCardAction({ signedIn: false, owned: null, slug: "a" })).toBe("buy");
  });
  it("đã đăng nhập, chưa biết có khóa chưa → chưa hiện nút, tránh hiện Mua khóa nhầm cho người đã mua", () => {
    expect(courseCardAction({ signedIn: true, owned: null, slug: "a" })).toBe("none");
  });
  it("khóa đã có → Vào học; khóa chưa có → Mua khóa", () => {
    expect(courseCardAction({ signedIn: true, owned: ["a"], slug: "a" })).toBe("learn");
    expect(courseCardAction({ signedIn: true, owned: ["a"], slug: "b" })).toBe("buy");
  });
});
