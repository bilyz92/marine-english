// Lưu tệp media theo nội dung (tên = sha256). Không dùng alias "@/" để CLI chạy thẳng bằng Node cũng import được.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";

export type Visibility = "public" | "protected";

export const MAX_MEDIA_BYTES = 104_857_600;

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const STORAGE_KEY = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * Ghi tệp bất biến: tệp tạm cùng thư mục → fsync → đọc lại kiểm sha256 → đổi tên nguyên tử. Đã có tệp cùng hash thì không ghi lại.
 * `hooks.beforeRename` chỉ dùng để test tình huống mất điện giữa chừng.
 */
export async function putFileAt(
  root: string,
  input: { bytes: Buffer; mime: string; visibility: Visibility },
  hooks: { beforeRename?: () => void } = {},
): Promise<{ storageKey: string; sha256: string; bytes: number }> {
  const ext = EXT_BY_MIME[input.mime];
  if (!ext) throw new Error(`Loại tệp không hỗ trợ: ${input.mime}`);
  if (input.bytes.length === 0 || input.bytes.length > MAX_MEDIA_BYTES) throw new Error("Kích thước tệp không hợp lệ");
  const hash = sha256(input.bytes);
  const storageKey = `${hash}.${ext}`;
  const dir = path.join(root, input.visibility);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, storageKey);
  const result = { storageKey, sha256: hash, bytes: input.bytes.length };
  const existing = await lstat(target).catch(() => null);
  if (existing) {
    // Tệp cùng tên đã có: chỉ tin khi là tệp thường, đúng kích thước và đúng sha256; sai thì báo lỗi, không ghi đè ngầm.
    if (!existing.isFile() || existing.size !== input.bytes.length || sha256(await readFile(target)) !== hash) {
      throw new Error(`Tệp đã có tại ${storageKey} không khớp nội dung`);
    }
    return result;
  }

  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  try {
    const handle = await open(tmp, "wx");
    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (sha256(await readFile(tmp)) !== hash) throw new Error("Tệp ghi ra không khớp sha256");
    hooks.beforeRename?.();
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  return result;
}

/** Chỉ tệp video đi qua putStreamAt; bảng chung EXT_BY_MIME (putFileAt, CLI media:add) không có video để không đường nào khác tạo được tệp video. */
const STREAM_EXT_BY_MIME: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };

export class StreamTooLarge extends Error {}
export class StreamRejected extends Error {}

async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await open(file, "r");
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

/**
 * Ghi tệp lớn (video) theo luồng: tệp tạm cùng thư mục, băm sha256 và đếm byte trong lúc ghi (không đệm cả tệp trong RAM),
 * nhận diện loại tệp bằng `sniff` trên `headBytes` byte đầu, fsync rồi đổi tên nguyên tử thành `<sha256>.<ext>`.
 * Vượt `maxBytes` → StreamTooLarge; rỗng hoặc sai loại → StreamRejected. Lỗi nào cũng xóa tệp tạm.
 */
export async function putStreamAt(
  root: string,
  input: { stream: ReadableStream<Uint8Array>; visibility: Visibility; maxBytes: number; sniff: (head: Buffer) => string | null; headBytes?: number },
): Promise<{ storageKey: string; sha256: string; bytes: number; mime: string }> {
  const headBytes = input.headBytes ?? 4096;
  const dir = path.join(root, input.visibility);
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  const hash = createHash("sha256");
  let bytes = 0;
  // Chỉ giữ đúng headBytes byte đầu để nhận diện (khúc của luồng có thể rất lớn).
  let head: Buffer[] = [];
  let headLength = 0;
  let mime: string | null = null;
  const decide = () => {
    mime = input.sniff(Buffer.concat(head, headLength));
    head = [];
    if (!mime || !STREAM_EXT_BY_MIME[mime]) throw new StreamRejected("Không phải tệp video hợp lệ");
  };
  const reader = input.stream.getReader();
  try {
    const handle = await open(tmp, "wx");
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        bytes += value.length;
        if (bytes > input.maxBytes) throw new StreamTooLarge("Tệp vượt giới hạn");
        hash.update(value);
        if (!mime) {
          const take = value.subarray(0, headBytes - headLength);
          head.push(Buffer.from(take));
          headLength += take.length;
          if (headLength >= headBytes) decide();
        }
        // write() có thể ghi thiếu: ghi tiếp tới hết khúc.
        for (let offset = 0; offset < value.length;) {
          const { bytesWritten } = await handle.write(value, offset, value.length - offset);
          if (bytesWritten <= 0) throw new Error("Không ghi được tệp");
          offset += bytesWritten;
        }
      }
      if (bytes === 0) throw new StreamRejected("Tệp rỗng");
      if (!mime) decide();
      await handle.sync();
      if ((await handle.stat()).size !== bytes) throw new Error("Tệp ghi xuống đĩa thiếu byte");
    } finally {
      await handle.close();
    }
    const sha = hash.digest("hex");
    const storageKey = `${sha}.${STREAM_EXT_BY_MIME[mime!]}`;
    const target = path.join(dir, storageKey);
    const existing = await lstat(target).catch(() => null);
    if (existing) {
      // Đã có tệp cùng tên: chỉ dùng khi đúng là tệp thường cùng kích thước và cùng sha256, không ghi đè ngầm.
      if (!existing.isFile() || existing.size !== bytes || (await sha256OfFile(target)) !== sha) throw new Error(`Tệp đã có tại ${storageKey} không khớp nội dung`);
      await rm(tmp, { force: true });
    } else {
      await rename(tmp, target);
    }
    return { storageKey, sha256: sha, bytes, mime: mime! };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Mở tệp được bảo vệ theo storageKey (không bao giờ lấy đường dẫn từ client); từ chối symlink và mọi thứ ngoài thư mục gốc. */
export function openProtectedAt(root: string, storageKey: string) {
  return openAt(root, "protected", storageKey);
}

export function openPublicAt(root: string, storageKey: string) {
  return openAt(root, "public", storageKey);
}

async function openAt(root: string, visibility: Visibility, storageKey: string): Promise<{ handle: FileHandle; size: number } | null> {
  if (!STORAGE_KEY.test(storageKey)) return null;
  try {
    const base = await realpath(path.join(root, visibility));
    const candidate = path.join(base, storageKey);
    const info = await lstat(candidate);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const resolved = await realpath(candidate);
    if (path.dirname(resolved) !== base) return null;
    const handle = await open(resolved, "r");
    return { handle, size: info.size };
  } catch {
    return null;
  }
}
