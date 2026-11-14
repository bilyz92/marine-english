import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Tải video về máy theo từng đoạn Range (docs/superpowers/plans/2026-11-12-video-lessons.md, Task 3). Hàm thuần: engine.ts
// đưa vào hàm đọc/ghi IndexedDB và fetch thật. sha256 băm cộng dồn (WebCrypto chỉ băm được một khối liền).

export const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024;

/** Chỉ nhận đúng đoạn đã xin: 206, `Content-Range: bytes <start>-<end>/<size>` khớp, đủ số byte. */
export function checkRangeResponse(
  res: { status: number; contentRange: string | null; length: number },
  want: { start: number; end: number; size: number },
): boolean {
  return res.status === 206 && res.contentRange === `bytes ${want.start}-${want.end}/${want.size}` && res.length === want.end - want.start + 1;
}

export type VideoDownloadResult = "done" | "failed" | "hash_mismatch" | "cancelled";

/**
 * Đoạn đã có thì đọc lại để băm (không tải lại), thiếu thì tải. Lỗi mạng / phản hồi sai → failed (giữ đoạn đã có, lần sau tải tiếp);
 * sai sha256 → xóa mọi đoạn; kho từ chối ghi (video đã bị dọn khỏi máy) → xóa mọi đoạn, cancelled. Kho trên máy lỗi (đầy bộ nhớ…)
 * → failed, đoạn đã ghi được giữ lại.
 */
export async function downloadInChunks(opts: Parameters<typeof download>[0]): Promise<VideoDownloadResult> {
  try {
    return await download(opts);
  } catch {
    return "failed";
  }
}

async function download(opts: {
  size: number;
  sha256: string;
  chunkBytes?: number;
  fetchRange(start: number, end: number): Promise<Uint8Array | null>;
  getPart(n: number): Promise<Uint8Array | undefined>;
  putPart(n: number, bytes: Uint8Array): Promise<boolean>;
  finish(): Promise<boolean>;
  deleteParts(count: number): Promise<void>;
  onProgress?: (done: number, total: number) => void;
}): Promise<VideoDownloadResult> {
  const chunk = opts.chunkBytes ?? VIDEO_CHUNK_BYTES;
  const count = Math.ceil(opts.size / chunk);
  const hash = sha256.create();
  let done = 0;
  opts.onProgress?.(done, opts.size);
  for (let n = 0; n < count; n++) {
    const start = n * chunk;
    const end = Math.min(opts.size, start + chunk) - 1;
    let bytes = await opts.getPart(n);
    if (!bytes || bytes.length !== end - start + 1) {
      bytes = (await opts.fetchRange(start, end)) ?? undefined;
      if (!bytes) return "failed";
      if (!(await opts.putPart(n, bytes))) {
        await opts.deleteParts(count);
        return "cancelled";
      }
    }
    hash.update(bytes);
    done += bytes.length;
    opts.onProgress?.(done, opts.size);
  }
  if (bytesToHex(hash.digest()) !== opts.sha256) {
    await opts.deleteParts(count);
    return "hash_mismatch";
  }
  if (!(await opts.finish())) {
    await opts.deleteParts(count);
    return "cancelled";
  }
  return "done";
}

/** Video trên máy không còn trong manifest nào đang lưu (bị thay, khóa bị thu hồi); video dùng chung ở khóa khác còn lưu thì giữ. */
export function staleVideoIds(stored: string[], manifests: { assets: { assetId: string; role: string }[] }[]): string[] {
  const keep = new Set(manifests.flatMap((m) => m.assets.filter((a) => a.role === "video").map((a) => a.assetId)));
  return stored.filter((id) => !keep.has(id));
}
