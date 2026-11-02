// Tìm khóa học trên trang Khóa học: không phân biệt hoa thường và dấu tiếng Việt; mọi từ gõ vào đều phải có.

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, " ").trim();

export function matchesCourse(course: { titleVi: string; titleEn: string }, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(`${course.titleVi} ${course.titleEn}`);
  return words.every((w) => haystack.includes(w));
}
