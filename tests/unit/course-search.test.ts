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
