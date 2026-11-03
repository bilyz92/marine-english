import { Readable } from "node:stream";
import { z } from "zod";
import { HttpError, route } from "@/lib/http";
import { proofFile } from "@/modules/orders/claims";
import { requireAdmin } from "@/modules/sessions/guards";
import { openProtected } from "@/modules/storage/storage";

// Ảnh chứng minh chuyển khoản: chỉ quản trị xem, đường dẫn tệp tra từ DB theo id.
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy ảnh");
  const file = await proofFile(admin, id);
  const opened = file && (await openProtected(file.storageKey));
  if (!file || !opened) throw new HttpError(404, "Không tìm thấy ảnh");
  const body = Readable.toWeb(opened.handle.createReadStream({ autoClose: true })) as ReadableStream;
  return new Response(body, {
    headers: {
      "content-type": file.mime, "content-length": String(opened.size), "cache-control": "private, no-store",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'",
    },
  });
});
