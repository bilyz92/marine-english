// Tìm khóa học trên trang Khóa học: không phân biệt hoa thường và dấu tiếng Việt; mọi từ gõ vào đều phải có.

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();

type SearchCategory = { titleVi: string; titleEn: string | null; parentTitleVi: string | null; parentTitleEn: string | null } | null;

/** Tìm theo tên khóa và tên Việt/Anh của danh mục, danh mục cha (khóa có danh mục). */
export function matchesCourse(course: { titleVi: string; titleEn: string; category?: SearchCategory }, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const c = course.category;
  const haystack = fold([course.titleVi, course.titleEn, c?.titleVi, c?.titleEn, c?.parentTitleVi, c?.parentTitleEn].filter(Boolean).join(" "));
  return words.every((w) => haystack.includes(w));
}

export type CourseCardAction = "buy" | "learn" | "none";

/** Nút trên thẻ khóa: khóa đã có thì Vào học; đã đăng nhập mà chưa biết thì chưa hiện, tránh mời mua nhầm khóa đã mua. */
export function courseCardAction(s: { signedIn: boolean; owned: string[] | null; slug: string }): CourseCardAction {
  if (!s.signedIn) return "buy";
  if (!s.owned) return "none";
  return s.owned.includes(s.slug) ? "learn" : "buy";
}
