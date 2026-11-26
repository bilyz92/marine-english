// Đường dẫn công khai của khóa, bài học thử, danh mục (SEO, chủ 26/11/2026). Không import gì từ máy chủ: thẻ khóa dùng cả ở trình duyệt.

export const courseUrl = (urlSlug: string) => `/khoa-hoc/${urlSlug}`;
export const trialUrl = (urlSlug: string, position: number) => `/khoa-hoc/${urlSlug}/hoc-thu/${position}`;
export const categoryUrl = (urlSlug: string) => `/khoa-hoc/danh-muc/${urlSlug}`;
