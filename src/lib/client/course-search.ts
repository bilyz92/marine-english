// Tìm khóa học trên trang Khóa học: không phân biệt hoa thường và dấu tiếng Việt; mọi từ gõ vào đều phải có.

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();

export function matchesCourse(course: { titleVi: string; titleEn: string }, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(`${course.titleVi} ${course.titleEn}`);
  return words.every((w) => haystack.includes(w));
}

export type CourseCardAction = "buy" | "learn" | "none";

/** Nút trên thẻ khóa: khóa đã có thì Vào học; đã đăng nhập mà chưa biết thì chưa hiện, tránh mời mua nhầm khóa đã mua. */
export function courseCardAction(s: { signedIn: boolean; owned: string[] | null; slug: string }): CourseCardAction {
  if (!s.signedIn) return "buy";
  if (!s.owned) return "none";
  return s.owned.includes(s.slug) ? "learn" : "buy";
}
