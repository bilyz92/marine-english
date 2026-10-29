// Số di động Việt Nam: lưu một dạng duy nhất +84 + 9 chữ số (đầu 3/5/7/8/9).
const CANONICAL = /^\+84[35789][0-9]{8}$/;

export function canonicalizeVnPhone(input: string): string | null {
  const compact = input.replace(/[\s().-]/g, "");
  let national: string;
  if (compact.startsWith("+84")) national = compact.slice(3);
  else if (compact.startsWith("84")) national = compact.slice(2);
  else if (compact.startsWith("0")) national = compact.slice(1);
  else return null;
  const canonical = `+84${national}`;
  return CANONICAL.test(canonical) ? canonical : null;
}

// Nhà cung cấp ZNS nhận dạng 0xxxxxxxxx; chỉ đổi khi gửi.
export function toZnsFormat(canonical: string): string {
  return `0${canonical.slice(3)}`;
}
