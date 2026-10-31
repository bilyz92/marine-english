import { Readable } from "node:stream";
import { HttpError, route } from "@/lib/http";
import { openPublic } from "@/modules/storage/storage";
import { MIME_BY_EXT } from "@/modules/storage/files";

// Tệp công khai (ảnh bán hàng, tệp bài học thử) theo tên sha256 — bất biến nên cache dài. Ở production Caddy phục vụ thẳng
// thư mục media/public cùng đường dẫn; route này dùng khi chạy dev hoặc khi chưa cấu hình Caddy. Chỉ đọc thư mục public.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ key: string }> }) => {
  const key = (await ctx.params).key;
  const opened = await openPublic(key);
  if (!opened) throw new HttpError(404, "Không tìm thấy tệp");
  const body = Readable.toWeb(opened.handle.createReadStream({ autoClose: true })) as ReadableStream;
  return new Response(body, {
    headers: {
      "content-type": MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream",
      "content-length": String(opened.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});
