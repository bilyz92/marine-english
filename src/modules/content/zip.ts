import { crc32, inflateRawSync } from "node:zlib";

// Đọc zip tối thiểu (không thêm thư viện): chỉ lưu thẳng (0) hoặc deflate (8), không zip64, không mã hóa.
// Mục chỉ được giải nén khi gọi read(giới hạn), dừng ngay khi vượt giới hạn (chống zip bomb).

/** reason "too_large": mục giải nén vượt giới hạn (kể cả khi kích thước khai trong zip là giả). */
export class ZipError extends Error {
  constructor(message: string, readonly reason: "invalid" | "too_large" = "invalid") {
    super(message);
  }
}

export type ZipEntry = { name: string; size: number; read(maxBytes: number): Buffer };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function unsafeName(name: string): boolean {
  const parts = name.replace(/\\/g, "/").split("/");
  return name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name) || parts.includes("..") || name.includes("\0");
}

/** counter: cộng dồn số mục trong thư mục trung tâm (kể cả thư mục) để giới hạn trên cả gói. */
export function readZip(bytes: Buffer, { maxEntries = 200, counter }: { maxEntries?: number; counter?: { entries: number } } = {}): ZipEntry[] {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("Không phải tệp zip");
  const count = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("Zip64 không được hỗ trợ");
  if (counter) counter.entries += count;
  if (count > maxEntries || (counter && counter.entries > maxEntries)) throw new ZipError(`Zip có quá nhiều mục (> ${maxEntries})`);
  if (cdOffset + cdSize > end) throw new ZipError("Zip hỏng");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new ZipError("Zip hỏng");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (unsafeName(name)) throw new ZipError(`Tên mục không an toàn: ${name}`);
    if (name.endsWith("/")) continue;
    if (compressed === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("Zip64 không được hỗ trợ");
    entries.push({
      name,
      size,
      read(maxBytes: number): Buffer {
        if (flags & 0x1) throw new ZipError(`Mục bị mã hóa: ${name}`);
        if (method !== 0 && method !== 8) throw new ZipError(`Kiểu nén không hỗ trợ: ${name}`);
        if (size > maxBytes) throw new ZipError(`Mục quá lớn: ${name}`, "too_large");
        if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) throw new ZipError("Zip hỏng");
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        if (start + compressed > buf.length) throw new ZipError("Zip hỏng");
        const body = buf.subarray(start, start + compressed);
        let data: Buffer;
        if (method === 0) {
          if (compressed !== size) throw new ZipError(`Zip hỏng: ${name}`);
          data = Buffer.from(body);
        } else {
          try {
            // maxOutputLength chặn cả khi kích thước khai trong zip là giả.
            data = inflateRawSync(body, { maxOutputLength: maxBytes });
          } catch (error) {
            const tooLarge = (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
            throw new ZipError(`Không giải nén được ${name}: ${(error as Error).message}`, tooLarge ? "too_large" : "invalid");
          }
        }
        if (data.length !== size || crc32(data) !== crc) throw new ZipError(`Zip hỏng (sai kích thước hoặc CRC): ${name}`);
        return data;
      },
    });
  }
  return entries;
}
