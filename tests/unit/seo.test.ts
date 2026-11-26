import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd, categoryDescription, categoryTitle, courseDescription, courseJsonLd, faqJsonLd, jsonLdHtml, metaDescription, organizationJsonLd, pageMetadata, PAGE_SEO, siteUrl, trimDescription,
} from "@/lib/seo";

const ORIGIN = "https://vi-du.vn";

const COURSE = {
  slug: "mea_3e_tanker", urlSlug: "may-ba-tau-dau-va-hoa-chat", titleVi: "Máy ba — Tàu dầu và hóa chất", titleEn: "Third Engineer — Tanker", priceVnd: 700000, lessonCount: 139,
  trialLessons: [{ position: 1, externalId: "a", title: "Giới thiệu bản thân" }, { position: 2, externalId: "b", title: "Kinh nghiệm" }],
  modules: [{ id: "m1", titleVi: "Chung", lessonCount: 123, trial: [] }, { id: "m2", titleVi: "Đặc thù", lessonCount: 16, trial: [] }],
  category: { titleVi: "Máy ba", titleEn: "3/E", parentTitleVi: null, parentTitleEn: null }, description: null,
};

describe("siteUrl", () => {
  it("ghép đường dẫn với APP_ORIGIN, không lặp dấu /", () => {
    expect(siteUrl("/khoa-hoc", ORIGIN)).toBe("https://vi-du.vn/khoa-hoc");
    expect(siteUrl("/khoa-hoc", `${ORIGIN}/`)).toBe("https://vi-du.vn/khoa-hoc");
    expect(siteUrl("/", ORIGIN)).toBe("https://vi-du.vn/");
  });
  it("mặc định đọc APP_ORIGIN từ env lúc gọi", () => {
    expect(siteUrl("/x")).toBe(`${process.env.APP_ORIGIN!.replace(/\/$/, "")}/x`);
  });
});

describe("pageMetadata", () => {
  it("có canonical, Open Graph tiếng Việt và thẻ Twitter ảnh lớn", () => {
    const m = pageMetadata({ title: "Khóa học", description: "Mô tả", path: "/khoa-hoc" });
    expect(m.title).toBe("Khóa học");
    expect(m.alternates?.canonical).toBe("/khoa-hoc");
    expect(m.openGraph).toMatchObject({ type: "website", locale: "vi_VN", siteName: "Marine English", url: "/khoa-hoc", title: "Khóa học", description: "Mô tả" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: "Khóa học", description: "Mô tả" });
    // Next thay cả object openGraph của layout: ảnh mặc định phải gắn lại ở đây, cả cho Twitter.
    expect(m.openGraph?.images).toEqual([{ url: "/anh-chia-se.png", width: 1200, height: 630, alt: "Marine English – Tiếng Anh cho thuyền viên bộ phận máy" }]);
    expect(m.twitter?.images).toEqual(["/anh-chia-se.png"]);
  });
  it("trang có ảnh riêng (opengraph-image của khóa) thì không gắn ảnh mặc định", () => {
    const m = pageMetadata({ title: "Khóa", description: "Mô tả", path: "/khoa-hoc/x", ownImage: true });
    expect(m.openGraph).not.toHaveProperty("images");
    expect(m.twitter).not.toHaveProperty("images");
  });
  it("tiêu đề tuyệt đối (trang chủ) không ghép mẫu, Open Graph dùng đúng chuỗi đó", () => {
    const m = pageMetadata({ title: { absolute: "Trang chủ | Marine English" }, description: "Mô tả", path: "/" });
    expect(m.title).toEqual({ absolute: "Trang chủ | Marine English" });
    expect(m.openGraph?.title).toBe("Trang chủ | Marine English");
  });
});

describe("mô tả từng trang công khai", () => {
  it("mỗi trang có mô tả riêng 120–160 ký tự, không trùng nhau, không phải câu chung cũ", () => {
    const descriptions = Object.values(PAGE_SEO).map((p) => p.description);
    for (const d of descriptions) {
      expect(d.length, d).toBeGreaterThanOrEqual(120);
      expect(d.length, d).toBeLessThanOrEqual(160);
      expect(d).not.toBe("Tiếng Anh cho thuyền viên bộ phận máy.");
    }
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
  it("trang chủ có từ khóa trong tiêu đề", () => {
    const title = PAGE_SEO.home.title as { absolute: string };
    expect(title.absolute).toMatch(/tiếng Anh/i);
    expect(title.absolute).toMatch(/thuyền viên/i);
  });
});

describe("trimDescription", () => {
  it("giữ nguyên câu ngắn, cắt câu dài ở ranh giới từ và thêm …, tối đa 160 ký tự", () => {
    expect(trimDescription("Ngắn gọn.")).toBe("Ngắn gọn.");
    const long = "từ ".repeat(80).trim();
    const cut = trimDescription(long);
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/\s…$/);
  });
});

describe("metaDescription", () => {
  it("câu ngắn (khóa tên ngắn, ít dữ liệu) được nối thêm câu có thật trên trang cho đủ 120 ký tự, không quá 160", () => {
    const short = courseDescription({ ...COURSE, titleVi: "A", titleEn: "B", lessonCount: 1, category: null, trialLessons: [], modules: [{ id: null, titleVi: "x", lessonCount: 1, trial: [] }] });
    expect(short.length).toBeLessThan(120);
    const d = metaDescription(short);
    expect(d.startsWith(short)).toBe(true);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
  });
  it("tên khóa 200 ký tự không có dấu cách: vẫn 120–160 ký tự (không cắt lùi về dấu cách quá sớm)", () => {
    const d = metaDescription(courseDescription({ ...COURSE, titleVi: "x".repeat(200), titleEn: "y".repeat(200) }));
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
  });
  it("câu dài thì chỉ cắt về 160", () => {
    const long = courseDescription({ ...COURSE, modules: Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, titleVi: `Module dài số ${i}`, lessonCount: 1, trial: [] })) });
    expect(metaDescription(long)).toBe(trimDescription(long));
  });
});

describe("courseDescription", () => {
  it("chỉ dùng dữ liệu thật của khóa: tên, số bài, module, chức danh, số bài học thử", () => {
    const d = courseDescription(COURSE);
    expect(d).toContain("Máy ba — Tàu dầu và hóa chất");
    expect(d).toContain("139 bài");
    expect(d).toContain("Chung");
    expect(d).toContain("Đặc thù");
    expect(d).toContain("3/E – Máy ba");
    expect(d).toContain("Học thử 2 bài");
  });
  it("khóa chưa xếp danh mục, chưa có bài học thử, chưa chia module: không nhắc tới", () => {
    const d = courseDescription({ ...COURSE, category: null, trialLessons: [], modules: [{ id: null, titleVi: "Nội dung khóa học", lessonCount: 139, trial: [] }] });
    expect(d).not.toContain("Dành cho");
    expect(d).not.toContain("Học thử");
    expect(d).not.toContain("module");
  });
  it("danh mục con: ghi cả chức danh cha", () => {
    const d = courseDescription({ ...COURSE, category: { titleVi: "Tàu dầu", titleEn: null, parentTitleVi: "Máy ba", parentTitleEn: "3/E" } });
    expect(d).toContain("3/E – Máy ba · Tàu dầu");
  });
  it("khóa có mô tả chủ viết: dùng mô tả đó thành một dòng chữ thuần (bỏ tiêu đề ##, dấu gạch đầu dòng), không ghép từ dữ liệu", () => {
    const d = courseDescription({ ...COURSE, description: "Mình là Máy trưởng tàu dầu\n\n## Bạn sẽ học gì?\n\nMở đầu:\n* Câu hỏi song ngữ\r\n- Luyện nói!" });
    expect(d).toBe("Mình là Máy trưởng tàu dầu. Mở đầu: Câu hỏi song ngữ. Luyện nói!");
  });
  it("mô tả chủ viết dài: cắt ở ranh giới từ trong 120–160 ký tự; dùng được cho meta, JSON-LD và thẻ chia sẻ", () => {
    const own = `${"Bài học sát tình huống thật trên tàu dầu ".repeat(6)}hết.`;
    const d = courseDescription({ ...COURSE, description: own });
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(own.startsWith(d.slice(0, -1))).toBe(true);
    expect(metaDescription(d)).toBe(d);
    expect(courseJsonLd(ORIGIN, { ...COURSE, description: own }, d).description).toBe(d);
  });
  it("mô tả chủ viết ngắn: meta nối thêm câu có thật cho đủ 120 ký tự", () => {
    const d = courseDescription({ ...COURSE, description: "Luyện phỏng vấn tàu dầu." });
    expect(d).toBe("Luyện phỏng vấn tàu dầu.");
    const m = metaDescription(d);
    expect(m.startsWith(d)).toBe(true);
    expect(m.length).toBeGreaterThanOrEqual(120);
    expect(m.length).toBeLessThanOrEqual(160);
  });
  it("mô tả chỉ có tiêu đề hoặc khoảng trắng: quay về cách ghép từ dữ liệu khóa", () => {
    expect(courseDescription({ ...COURSE, description: "## Giới thiệu\n\n   " })).toBe(courseDescription(COURSE));
  });
});

describe("JSON-LD", () => {
  it("nhúng an toàn: không còn < > & thô, không thoát được khỏi thẻ script, đọc lại ra đúng dữ liệu", () => {
    const data = { name: "</script><script>alert(1)</script> & \u2028" };
    const html = jsonLdHtml(data);
    expect(html).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(html)).toEqual(data);
  });
  it("Organization chỉ gồm tên, địa chỉ site, logo có thật (SITE_INFO còn trống)", () => {
    const o = organizationJsonLd(ORIGIN);
    expect(o).toEqual({
      "@context": "https://schema.org", "@type": "EducationalOrganization", name: "Marine English", url: "https://vi-du.vn/", logo: "https://vi-du.vn/icon-512.png",
    });
  });
  it("Organization thêm tên hộ kinh doanh và email chỉ khi SITE_INFO đã có", () => {
    const o = organizationJsonLd(ORIGIN, { business: "Hộ kinh doanh Thử", zalo: null, messenger: null, email: "a@b.vn" });
    expect(o).toMatchObject({ legalName: "Hộ kinh doanh Thử", email: "a@b.vn" });
  });
  it("Course có tên, mô tả, đơn vị cung cấp, giá VND thật và địa chỉ trang khóa (đường dẫn đọc được, không phải mã nội bộ)", () => {
    const c = courseJsonLd(ORIGIN, COURSE, "Mô tả");
    expect(c).toMatchObject({
      "@type": "Course", name: COURSE.titleVi, alternateName: COURSE.titleEn, description: "Mô tả", url: "https://vi-du.vn/khoa-hoc/may-ba-tau-dau-va-hoa-chat", inLanguage: "vi",
      provider: { "@type": "EducationalOrganization", name: "Marine English", url: "https://vi-du.vn/" },
      offers: { "@type": "Offer", price: 700000, priceCurrency: "VND", category: "Paid", url: "https://vi-du.vn/khoa-hoc/may-ba-tau-dau-va-hoa-chat" },
    });
  });
  it("BreadcrumbList đánh số từ 1 với địa chỉ tuyệt đối", () => {
    const b = breadcrumbJsonLd(ORIGIN, [{ name: "Trang chủ", path: "/" }, { name: "Khóa học", path: "/khoa-hoc" }, { name: "Máy ba", path: "/khoa-hoc/x" }]);
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: "https://vi-du.vn/" },
      { "@type": "ListItem", position: 2, name: "Khóa học", item: "https://vi-du.vn/khoa-hoc" },
      { "@type": "ListItem", position: 3, name: "Máy ba", item: "https://vi-du.vn/khoa-hoc/x" },
    ]);
  });
  it("FAQPage lấy đúng câu hỏi và trả lời đang hiện trên trang", () => {
    const f = faqJsonLd([{ q: "Hỏi?", a: "Đáp." }]);
    expect(f).toEqual({
      "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Hỏi?", acceptedAnswer: { "@type": "Answer", text: "Đáp." } }],
    });
  });
});

describe("trang danh mục", () => {
  const group = (over: object = {}) => ({
    titleVi: "Thực tập máy", titleEn: "Engine Cadet", comingSoon: false,
    courses: [{ titleVi: "Luyện phỏng vấn Engine Cadet", comingSoon: false }, { titleVi: "Tàu dầu", comingSoon: true }], subgroups: [], ...over,
  });
  it("tiêu đề theo tên danh mục; 'Khóa khác' giữ nguyên tên", () => {
    expect(categoryTitle(group())).toBe("Khóa tiếng Anh cho Engine Cadet – Thực tập máy");
    expect(categoryTitle(group({ titleVi: "Khóa khác", titleEn: null, urlSlug: "khac" }))).toBe("Khóa khác");
  });
  it("mô tả 120–160 ký tự từ dữ liệu thật: tên danh mục, tên khóa đang bán; không hứa học thử khi chỉ có khóa sắp ra mắt", () => {
    const d = categoryDescription(group());
    expect(d).toContain("Engine Cadet – Thực tập máy");
    expect(d).toContain("Luyện phỏng vấn Engine Cadet");
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
    const soon = categoryDescription(group({ comingSoon: true, courses: [{ titleVi: "Tàu dầu", comingSoon: true }] }));
    expect(soon).toContain("sắp ra mắt");
    expect(soon).not.toMatch(/học thử/i);
  });
});
