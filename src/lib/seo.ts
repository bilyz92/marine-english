import type { Metadata } from "next";
import { SITE_INFO } from "@/content/site-info";
import { env } from "@/lib/env";
import type { CourseCategoryLabel, CourseDetail } from "@/modules/content/catalog";
import type { ArticleMeta } from "@/modules/articles/articles";
import { courseUrl } from "@/modules/content/paths";
import { OTHER_CATEGORY_URL_SLUG } from "@/modules/content/url-slug";

// SEO cơ bản cho site công khai: tiêu đề và mô tả từng trang, canonical, Open Graph, JSON-LD. Địa chỉ tuyệt đối lấy APP_ORIGIN lúc chạy
// (bản build Docker không có biến môi trường), nên mọi hàm cần gốc site đều nhận origin hoặc đọc env() khi được gọi.

export const SITE_NAME = "Marine English";

/** Địa chỉ tuyệt đối của một đường dẫn trong site. */
export function siteUrl(path: string, origin: string = env().APP_ORIGIN): string {
  return new URL(path, origin).toString();
}

type Title = string | { absolute: string };

/** Ảnh chia sẻ mặc định (src/app/anh-chia-se.png/route.tsx). */
export const DEFAULT_SHARE_IMAGE = "/anh-chia-se.png";

/**
 * Metadata một trang công khai: canonical về đường dẫn sạch (không tham số), Open Graph và Twitter cùng tiêu đề, mô tả. Next thay cả
 * object openGraph của layout nên ảnh mặc định gắn ở đây; trang có opengraph-image riêng (ownImage) thì để Next tự gắn ảnh đó.
 */
export function pageMetadata({ title, description, path, ownImage = false }: { title: Title; description: string; path: string; ownImage?: boolean }): Metadata {
  const shareTitle = typeof title === "string" ? title : title.absolute;
  const images = ownImage ? {} : { images: [{ url: DEFAULT_SHARE_IMAGE, width: 1200, height: 630, alt: `${SITE_NAME} – Tiếng Anh cho thuyền viên bộ phận máy` }] };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", locale: "vi_VN", siteName: SITE_NAME, url: path, title: shareTitle, description, ...images },
    twitter: { card: "summary_large_image", title: shareTitle, description, ...(ownImage ? {} : { images: [DEFAULT_SHARE_IMAGE] }) },
  };
}

/** Tiêu đề và mô tả các trang tĩnh: chỉ nói điều có trên chính trang đó (trang chủ, giới thiệu, liên hệ, chính sách). */
export const PAGE_SEO = {
  home: {
    title: { absolute: "Tiếng Anh cho thuyền viên bộ phận máy | Marine English" },
    description:
      "Học tiếng Anh buồng máy cho thuyền viên: bài do máy trưởng tàu dầu soạn, đúng tình huống thật trên tàu, giải thích tiếng Việt, học được cả khi tàu mất mạng.",
    path: "/",
  },
  courses: {
    title: "Khóa học tiếng Anh thuyền viên máy",
    description:
      "Các khóa tiếng Anh cho thuyền viên bộ phận máy, chia theo chức danh từ Engine Cadet đến máy trưởng: luyện phỏng vấn và tiếng Anh buồng máy, học trên điện thoại.",
    path: "/khoa-hoc",
  },
  about: {
    title: "Câu chuyện người sáng lập",
    description:
      "Từ Engine Cadet đến Chief Engineer trên tàu Tanker trong 7 năm: câu chuyện người soạn khóa tiếng Anh cho thuyền viên máy, giúp anh em tự tin khi phỏng vấn.",
    path: "/gioi-thieu",
  },
  contact: {
    title: "Liên hệ",
    description:
      "Liên hệ Marine English để hỏi về khóa tiếng Anh cho thuyền viên máy, thanh toán hoặc dữ liệu cá nhân. Người hỗ trợ trên bờ trả lời trong giờ làm việc.",
    path: "/lien-he",
  },
  articles: {
    title: "Bài viết",
    description:
      "Bài viết cho thuyền viên bộ phận máy: câu hỏi phỏng vấn Engine Cadet bằng tiếng Anh kèm nghĩa tiếng Việt, câu trả lời mẫu và cách luyện nói cho buổi phỏng vấn.",
    path: "/bai-viet",
  },
  policies: {
    title: "Chính sách",
    description:
      "Chính sách bảo mật và điều khoản sử dụng của Marine English: thông tin thu khi tạo tài khoản, các bên xử lý dữ liệu, học offline và giới hạn 2 thiết bị.",
    path: "/chinh-sach",
  },
} satisfies Record<string, { title: Title; description: string; path: string }>;

/** Mô tả meta tối đa 160 ký tự: cắt ở ranh giới từ (nếu vẫn còn ≥120 ký tự, không thì cắt ngang từ), thêm dấu "…". */
export function trimDescription(text: string, max = 160, min = 120): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const atWord = cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,.;:–—-]+$/, "");
  return `${atWord.length >= min - 1 ? atWord : cut.trimEnd()}…`;
}

// Câu nối thêm khi mô tả ghép từ dữ liệu khóa còn dưới 120 ký tự: đều là điều trang khóa và trang chủ đang ghi.
const FILLERS = [
  "Học trên điện thoại, chạy được cả Android và iPhone.",
  "Thanh toán bằng VietQR, mọi ngân hàng Việt Nam.",
  "Tải bài về máy để học cả khi tàu mất mạng.",
];

/** Mô tả meta 120–160 ký tự: câu ngắn thì nối thêm câu có thật ở trên cho đủ 120, rồi cắt về 160. */
export function metaDescription(text: string): string {
  let out = text;
  for (const extra of FILLERS) {
    if (out.length >= 120) break;
    out = `${out} ${extra}`;
  }
  return trimDescription(out);
}

type SeoCourse = Pick<CourseDetail, "urlSlug" | "titleVi" | "titleEn" | "priceVnd" | "lessonCount" | "trialLessons" | "modules" | "description"> & { category: CourseCategoryLabel | null };

const label = (vi: string, en: string | null) => (en ? `${en} – ${vi}` : vi);

/** Chức danh của khóa (đối tượng học) theo danh mục chủ đã xếp; danh mục con ghi sau chức danh cha. */
export function courseAudience(course: Pick<SeoCourse, "category">): string | null {
  const c = course.category;
  if (!c) return null;
  return c.parentTitleVi ? `${label(c.parentTitleVi, c.parentTitleEn)} · ${label(c.titleVi, c.titleEn)}` : label(c.titleVi, c.titleEn);
}

/** Mô tả chủ viết thành một dòng chữ thuần: bỏ dòng tiêu đề "## ", bỏ dấu gạch đầu dòng, dòng chưa có dấu câu cuối thì thêm ".". */
function ownDescriptionText(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("## "))
    .map((l) => l.replace(/^[*-]\s+/, ""))
    .map((l) => (/[.!?:;…]$/.test(l) ? l : `${l}.`))
    .join(" ");
}

/**
 * Giới thiệu khóa cho meta, JSON-LD, thẻ chia sẻ: mô tả chủ viết (một dòng, cắt về 160 ký tự) nếu có; không thì ghép từ dữ liệu có thật
 * trong DB: tên, số bài, chức danh, module, bài học thử.
 */
export function courseDescription(course: SeoCourse): string {
  const own = course.description ? ownDescriptionText(course.description) : "";
  if (own) return trimDescription(own);
  const audience = courseAudience(course);
  const named = course.modules.filter((m) => m.id !== null);
  const parts = [
    `Khóa ${course.titleVi} (${course.titleEn}) gồm ${course.lessonCount} bài tiếng Anh cho thuyền viên máy${audience ? `, dành cho ${audience}` : ""}.`,
    named.length ? `Chia ${named.length} module: ${named.map((m) => m.titleVi).join(", ")}.` : "",
    course.trialLessons.length ? `Học thử ${course.trialLessons.length} bài miễn phí trước khi mua.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

type SeoCategory = { titleVi: string; titleEn: string | null; urlSlug?: string; comingSoon: boolean; courses: { titleVi: string; comingSoon: boolean }[]; subgroups: { courses: { titleVi: string; comingSoon: boolean }[] }[] };

const categoryName = (g: SeoCategory) => (g.urlSlug === OTHER_CATEGORY_URL_SLUG ? g.titleVi : label(g.titleVi, g.titleEn));

/** Tiêu đề trang danh mục (/khoa-hoc/danh-muc/…): theo tên chức danh; "Khóa khác" giữ nguyên tên. */
export function categoryTitle(g: SeoCategory): string {
  return g.urlSlug === OTHER_CATEGORY_URL_SLUG ? g.titleVi : `Khóa tiếng Anh cho ${categoryName(g)}`;
}

/** Mô tả trang danh mục từ dữ liệu thật: tên danh mục, tên các khóa đang bán; chỉ có khóa sắp ra mắt thì nói vậy, không nhắc học thử. */
export function categoryDescription(g: SeoCategory): string {
  const all = [...g.courses, ...g.subgroups.flatMap((s) => s.courses)];
  const onSale = all.filter((c) => !c.comingSoon).map((c) => c.titleVi);
  const who = g.urlSlug === OTHER_CATEGORY_URL_SLUG ? "Các khóa tiếng Anh khác cho thuyền viên máy" : `Khóa tiếng Anh cho thuyền viên máy dành cho ${categoryName(g)}`;
  const text = onSale.length
    ? `${who}: ${onSale.join(", ")}. Học thử bài đầu miễn phí trước khi mua.`
    : `${who}: ${all.length} khóa sắp ra mắt.`;
  return metaDescription(text);
}

const CONTEXT = "https://schema.org";

/** JSON trong thẻ <script type="application/ld+json">: thoát < > & và U+2028/2029 để chuỗi từ DB không đóng được thẻ script. */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Đơn vị đào tạo: chỉ tên, địa chỉ site, logo, và tên hộ kinh doanh, email khi SITE_INFO có (chưa có thì không ghi). */
export function organizationJsonLd(origin: string, info: typeof SITE_INFO = SITE_INFO) {
  return {
    "@context": CONTEXT,
    "@type": "EducationalOrganization",
    // Tên thương hiệu và biểu tượng app đang hiện ở đầu mọi trang; tên hộ kinh doanh, email chỉ khi chủ đã cung cấp (SITE_INFO).
    name: SITE_NAME,
    url: siteUrl("/", origin),
    logo: siteUrl("/icon-512.png", origin),
    ...(info.business ? { legalName: info.business } : {}),
    ...(info.email ? { email: info.email } : {}),
  };
}

export function courseJsonLd(origin: string, course: SeoCourse, description: string) {
  const url = siteUrl(courseUrl(course.urlSlug), origin);
  return {
    "@context": CONTEXT,
    "@type": "Course",
    name: course.titleVi,
    alternateName: course.titleEn,
    description,
    url,
    inLanguage: "vi",
    provider: { "@type": "EducationalOrganization", name: SITE_NAME, url: siteUrl("/", origin) },
    offers: { "@type": "Offer", price: course.priceVnd, priceCurrency: "VND", category: "Paid", availability: "https://schema.org/InStock", url },
    // Học trên web và app PWA (có tải về học offline): hình thức trực tuyến.
    hasCourseInstance: { "@type": "CourseInstance", courseMode: "Online" },
  };
}

/** Bài viết (/bai-viet/…): chỉ dữ liệu có trong tệp bài (tiêu đề, mô tả, ngày) và tên site; không bịa tác giả hay ảnh. */
export function articleJsonLd(origin: string, article: Pick<ArticleMeta, "title" | "description" | "path" | "date">) {
  const url = siteUrl(article.path, origin);
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.date,
    inLanguage: "vi",
    url,
    mainEntityOfPage: url,
    publisher: { "@type": "EducationalOrganization", name: SITE_NAME, url: siteUrl("/", origin), logo: siteUrl("/icon-512.png", origin) },
  };
}

export function breadcrumbJsonLd(origin: string, items: { name: string; path: string }[]) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: siteUrl(it.path, origin) })),
  };
}

export function faqJsonLd(items: { q: string; a: string }[]) {
  return {
    "@context": CONTEXT,
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}
