import { describe, expect, it } from "vitest";
import { parseDescription } from "@/app/(site)/khoa-hoc/[slug]/course-description";

describe("parseDescription", () => {
  it("dòng trống tách đoạn, ## là tiêu đề, * và - là gạch đầu dòng, xuống dòng đơn giữ trong đoạn", () => {
    expect(parseDescription("Câu 1\nCâu 2\n\n## Bạn sẽ học gì?\n\nMở đầu:\n* Một\n- Hai\nKết\r\n\r\n<b>x</b>")).toEqual([
      { kind: "p", lines: ["Câu 1", "Câu 2"] },
      { kind: "h", text: "Bạn sẽ học gì?" },
      { kind: "p", lines: ["Mở đầu:"] },
      { kind: "ul", items: ["Một", "Hai"] },
      { kind: "p", lines: ["Kết"] },
      { kind: "p", lines: ["<b>x</b>"] },
    ]);
  });

  it("dòng chỉ có khoảng trắng vẫn là dòng trống; chữ rỗng → không khối nào", () => {
    expect(parseDescription("A\n   \nB")).toEqual([{ kind: "p", lines: ["A"] }, { kind: "p", lines: ["B"] }]);
    expect(parseDescription("")).toEqual([]);
  });
});
