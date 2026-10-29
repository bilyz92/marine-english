import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Chuỗi ngẫu nhiên 32 byte, mã hóa base64url (43 ký tự).
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hmacHex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

// So sánh hằng thời gian; khác độ dài thì trả false ngay.
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
