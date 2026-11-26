import { describe, expect, it } from "vitest";
import { getArticle, listArticles, parseArticle } from "@/modules/articles/articles";
import { articleJsonLd } from "@/lib/seo";

const OK = `---
tieu_de: "Tiêu đề: có dấu hai chấm"
mo_ta: Mô tả ngắn
duong_dan: /bai-viet/bai-thu
ngay: 2026-11-26
---

## Phần một

Chữ.
`;

describe("bài viết Markdown trong repo", () => {
  it("đọc phần đầu (giá trị trong ngoặc kép giữ dấu hai chấm) và thân bài", () => {
    const a = parseArticle("/x/bai-thu.md", OK);
    expect(a).toMatchObject({ slug: "bai-thu", title: "Tiêu đề: có dấu hai chấm", description: "Mô tả ngắn", path: "/bai-viet/bai-thu", date: "2026-11-26" });
    expect(a.blocks[0]).toEqual({ t: "h", level: 2, c: [{ t: "text", v: "Phần một" }] });
  });

  it("thiếu trường, đường dẫn sai, tên tệp không khớp, ngày sai → lỗi (lỗi lúc build, không lặng lẽ bỏ bài)", () => {
    expect(() => parseArticle("/x/bai-thu.md", OK.replace("mo_ta: Mô tả ngắn\n", ""))).toThrow(/mo_ta/);
    expect(() => parseArticle("/x/bai-thu.md", OK.replace("/bai-viet/bai-thu", "/khac/bai-thu"))).toThrow(/duong_dan/);
    expect(() => parseArticle("/x/bai-thu.md", OK.replace("/bai-viet/bai-thu", "/bai-viet/Bài_Thử"))).toThrow(/duong_dan/);
    expect(() => parseArticle("/x/ten-khac.md", OK)).toThrow(/tên tệp/);
    expect(() => parseArticle("/x/bai-thu.md", OK.replace("2026-11-26", "26/11/2026"))).toThrow(/ngay/);
    expect(() => parseArticle("/x/bai-thu.md", "Không có phần đầu")).toThrow(/phần đầu/);
  });

  it("bài đã duyệt: link khóa dùng đường dẫn đọc được, không còn ghi chú cho chủ hay trạng thái nháp", () => {
    const a = getArticle("cau-hoi-phong-van-engine-cadet")!;
    expect(a.title).toMatch(/^Câu hỏi phỏng vấn Engine Cadet/);
    const json = JSON.stringify(a);
    expect(json).toContain("/khoa-hoc/luyen-phong-van-engine-cadet/hoc-thu/1");
    expect(json).not.toMatch(/mea_cadet_interview|Ghi chú cho anh|BẢN NHÁP|<!--/);
    expect(listArticles().map((x) => x.slug)).toContain("cau-hoi-phong-van-engine-cadet");
    expect(getArticle("khong-co")).toBeNull();
  });

  it("JSON-LD Article: tiêu đề, mô tả, ngày, địa chỉ tuyệt đối, ngôn ngữ, đơn vị xuất bản", () => {
    const meta = { slug: "a", title: "T", description: "M", path: "/bai-viet/a", date: "2026-11-26" };
    expect(articleJsonLd("https://vi-du.vn", meta)).toMatchObject({
      "@type": "Article", headline: "T", description: "M", datePublished: "2026-11-26", inLanguage: "vi",
      mainEntityOfPage: "https://vi-du.vn/bai-viet/a", url: "https://vi-du.vn/bai-viet/a",
      publisher: { "@type": "EducationalOrganization", name: "Marine English" },
    });
  });
});
