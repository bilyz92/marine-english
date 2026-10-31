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
