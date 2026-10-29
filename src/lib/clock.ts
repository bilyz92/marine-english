// Giờ của ứng dụng; test có thể cố định. Thời điểm ghi DB vẫn lấy now() của DB.
let fixed: Date | null = null;

export function now(): Date {
  return fixed ? new Date(fixed) : new Date();
}

export function setTestNow(value: Date | null): void {
  fixed = value;
}
