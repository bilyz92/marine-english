import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeHref } from "@/modules/articles/markdown";

describe("parseInline", () => {
  it("chữ đậm, nghiêng, đậm chứa nghiêng; dấu * lẻ giữ nguyên", () => {
    expect(parseInline("a **b** c *d* e")).toEqual([
      { t: "text", v: "a " }, { t: "strong", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c " }, { t: "em", c: [{ t: "text", v: "d" }] }, { t: "text", v: " e" },
    ]);
    expect(parseInline("**x *y***")).toEqual([{ t: "strong", c: [{ t: "text", v: "x " }, { t: "em", c: [{ t: "text", v: "y" }] }] }]);
    expect(parseInline("5 * 3 = 15")).toEqual([{ t: "text", v: "5 * 3 = 15" }]);
  });

  it("link nội bộ và https giữ; javascript:, data:, //host, đường dẫn tương đối thành chữ thường", () => {
    expect(parseInline("[Xem khóa](/khoa-hoc/x)")).toEqual([{ t: "link", href: "/khoa-hoc/x", c: [{ t: "text", v: "Xem khóa" }] }]);
    expect(parseInline("[A](https://vi-du.vn/a)")).toEqual([{ t: "link", href: "https://vi-du.vn/a", c: [{ t: "text", v: "A" }] }]);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.vn", "khoa-hoc", "JavaScript:alert(1)"]) {
      expect([bad, parseInline(`[bấm](${bad})`)]).toEqual([bad, [{ t: "text", v: "bấm" }]]);
    }
  });

  it("HTML thô chỉ là chữ (React tự thoát khi hiện), không thành thẻ", () => {
    expect(parseInline("<script>alert(1)</script> <b>x</b>")).toEqual([{ t: "text", v: "<script>alert(1)</script> <b>x</b>" }]);
  });
});

describe("safeHref", () => {
  it("chỉ nhận /đường-dẫn trong site và http(s)", () => {
    expect(safeHref("/bai-viet/a#b")).toBe("/bai-viet/a#b");
    expect(safeHref("http://a.vn")).toBe("http://a.vn");
    expect(safeHref("//a.vn")).toBeNull();
    expect(safeHref("/\\a.vn")).toBeNull();
    expect(safeHref("mailto:a@b.vn")).toBeNull();
  });
});

describe("parseMarkdown", () => {
  it("tiêu đề ##/###, đoạn văn nối dòng, danh sách gạch đầu dòng và đánh số, trích dẫn nhiều đoạn", () => {
    const md = [
      "## 1. Giới thiệu", "", "Dòng một", "dòng hai.", "", "- **Q?** Nghĩa.", "* Hai", "", "1. Một", "2. Hai", "", "### Nhỏ", "",
      "> Câu tiếng Anh.", ">", "> *Câu tiếng Việt.*", "", "Hết.",
    ].join("\n");
    expect(parseMarkdown(md)).toEqual([
      { t: "h", level: 2, c: [{ t: "text", v: "1. Giới thiệu" }] },
      { t: "p", c: [{ t: "text", v: "Dòng một dòng hai." }] },
      { t: "ul", items: [[{ t: "strong", c: [{ t: "text", v: "Q?" }] }, { t: "text", v: " Nghĩa." }], [{ t: "text", v: "Hai" }]] },
      { t: "ol", start: 1, items: [[{ t: "text", v: "Một" }], [{ t: "text", v: "Hai" }]] },
      { t: "h", level: 3, c: [{ t: "text", v: "Nhỏ" }] },
      { t: "quote", c: [{ t: "p", c: [{ t: "text", v: "Câu tiếng Anh." }] }, { t: "p", c: [{ t: "em", c: [{ t: "text", v: "Câu tiếng Việt." }] }] }] },
      { t: "p", c: [{ t: "text", v: "Hết." }] },
    ]);
  });

  it("# (h1) hạ thành h2: trang đã có h1 là tiêu đề bài; xuống dòng Windows cũng đọc được", () => {
    expect(parseMarkdown("# Tựa\r\n\r\nChữ")).toEqual([{ t: "h", level: 2, c: [{ t: "text", v: "Tựa" }] }, { t: "p", c: [{ t: "text", v: "Chữ" }] }]);
  });
});
