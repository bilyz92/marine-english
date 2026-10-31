// Kiểm manifest sao lưu trước khi khôi phục. Manifest đến từ nơi lưu ngoài nên là dữ liệu không tin cậy:
// xác thực bằng MAC theo khóa sao lưu, rồi kiểm từng trường theo dạng cố định trước khi dùng trong SQL hay đường dẫn.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Bảng đếm cố định; không bao giờ lấy tên bảng từ manifest. */
export const COUNT_TABLES = ["orders", "bank_transactions", "enrollments"];

const HEX64 = /^[0-9a-f]{64}$/;
const KID = /^[a-z0-9_-]{1,32}$/;
const NAME = /^\d{8}-\d{6}$/;
const STORAGE_KEY = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;
const MIGRATION = /^[0-9]{14}_[a-z0-9_]{1,100}$/;

function fail(message) {
  throw new Error(`manifest không hợp lệ: ${message}`);
}
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : fail("số dòng"));

export function validateManifest(m) {
  if (!m || typeof m !== "object" || m.version !== 1) fail("phiên bản");
  if (!NAME.test(m.name ?? "")) fail("tên bản");
  if (Number.isNaN(Date.parse(m.createdAt))) fail("thời điểm");
  if (!KID.test(m.kid ?? "")) fail("mã khóa");
  if (m.dump?.file !== "db.dump.gpg" || !HEX64.test(m.dump?.sha256 ?? "") || !Number.isInteger(m.dump?.bytes)) fail("bản dump");
  if (m.migration !== null && !MIGRATION.test(m.migration ?? "")) fail("migration");
  const keys = Object.keys(m.counts ?? {}).sort();
  if (keys.join() !== [...COUNT_TABLES].sort().join()) fail("bảng đếm");
  for (const t of COUNT_TABLES) count(m.counts[t]);
  if (!Array.isArray(m.media)) fail("media");
  for (const x of m.media) {
    if (!HEX64.test(x?.sha256 ?? "") || !KID.test(x?.kid ?? "") || !STORAGE_KEY.test(x?.storageKey ?? "") || !["public", "protected"].includes(x?.visibility)) fail("tệp media");
  }
  return m;
}

export function manifestMac(raw, keyContent) {
  return createHmac("sha256", keyContent).update(raw).digest("hex");
}

export function verifyManifestMac(raw, macHex, keyContent) {
  if (typeof macHex !== "string" || !HEX64.test(macHex.trim())) return false;
  return timingSafeEqual(Buffer.from(manifestMac(raw, keyContent), "hex"), Buffer.from(macHex.trim(), "hex"));
}
