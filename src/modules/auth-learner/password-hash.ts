import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Băm mật khẩu học viên bằng scrypt có sẵn trong Node: N=2^15, r=8, p=1 (khoảng 32 MB mỗi lần băm), muối 16 byte, khóa 32 byte.
// Chuỗi lưu: scrypt$<log2 N>$<r>$<p>$<muối base64>$<băm base64>, để sau này tăng tham số mà vẫn kiểm được băm cũ.
const LOG_N = 15;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, { ...opts, maxmem: MAXMEM }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N: 2 ** LOG_N, r: R, p: P });
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (!Number.isInteger(logN) || logN! < 14 || logN! > 20 || r !== R || p !== P) return false;
  const expected = Buffer.from(parts[5]!, "base64");
  if (expected.length !== KEY_BYTES) return false;
  const key = await derive(password, Buffer.from(parts[4]!, "base64"), { N: 2 ** logN!, r, p });
  return timingSafeEqual(key, expected);
}

/** Băm giả để tài khoản không có cũng tốn đúng một lần băm như tài khoản có (không lộ qua thời gian trả lời).
 *  Chuỗi băm tính sẵn (của "dummy-password-for-timing"), để lần gọi đầu không tốn gấp đôi. */
const DUMMY_HASH = "scrypt$15$8$1$h6Aki6R308GkDDg6UT87UQ==$ngwbUQpzR/QnmPCSDPJJZOHu9KrluNdpo+A26IboJmY=";
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}

const COMMON = new Set(["12345678", "123456789", "1234567890", "password", "matkhau123", "matkhau", "11111111", "00000000", "88888888", "abc12345", "qwerty123", "12345678a"]);

export type PasswordProblem = "too_short" | "too_long" | "common" | "phone";

/** Chính sách: 8–128 ký tự, không là mật khẩu phổ biến, không là chính số điện thoại. Không bắt buộc ký tự đặc biệt. */
export function passwordProblem(password: string, phoneCanonical: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < 8) return "too_short";
  if (length > 128) return "too_long";
  if (COMMON.has(password.toLowerCase())) return "common";
  const national = phoneCanonical.slice(3);
  if ([national, `0${national}`, `84${national}`, phoneCanonical].includes(password.trim())) return "phone";
  return null;
}
