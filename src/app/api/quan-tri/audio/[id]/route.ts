import { z } from "zod";
import { fileResponse } from "@/lib/file-response";
import { HttpError, route } from "@/lib/http";
import { lessonAudioFile } from "@/modules/content/lesson-audio";
import { requireAdmin } from "@/modules/sessions/guards";
import { openProtected } from "@/modules/storage/storage";

// Quản trị nghe lại ghi âm đã gắn vào bài (có Range để tua).
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy tệp");
  const file = await lessonAudioFile(admin, id);
  const opened = file && (await openProtected(file.storageKey));
  if (!file || !opened) throw new HttpError(404, "Không tìm thấy tệp");
  return fileResponse(req, opened, file.mime, { "content-security-policy": "default-src 'none'" });
});
