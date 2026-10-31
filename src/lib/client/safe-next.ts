/**
 * Đường dẫn quay lại sau đăng nhập: chỉ trong site. Trình duyệt bỏ tab và xuống dòng khi đọc URL, nên "/\t/evil.com"
 * thành "//evil.com": phân tích bằng URL rồi so origin thay vì chỉ xem ký tự đầu.
 */
export function safeNext(value: string | null | undefined, origin: string): string {
  const fallback = "/hoc";
  if (!value || !value.startsWith("/") || /[\x00-\x1f\\]/.test(value)) return fallback;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}
