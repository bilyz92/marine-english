import { Readable } from "node:stream";
import type { FileHandle } from "node:fs/promises";

// Trả tệp đã mở, hỗ trợ Range (trình phát âm thanh tua và tải tiếp được).

/** Đoạn [start, end] theo header Range; không có Range → null; sai cú pháp hoặc ngoài kích thước → "invalid". */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (header === null) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start >= size || end < start ? "invalid" : { start, end };
}

export async function fileResponse(req: Request, opened: { handle: FileHandle; size: number }, mime: string, extra: Record<string, string> = {}): Promise<Response> {
  const { handle, size } = opened;
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    await handle.close();
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  // Client ngắt thì luồng web bị hủy, kéo theo hủy luồng đọc và đóng tệp.
  const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "content-type": mime,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...extra,
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
