import { fileResponse } from "@/lib/file-response";
import { HttpError, route } from "@/lib/http";
import { trialVideo } from "@/modules/content/lesson-video";
import { openProtected } from "@/modules/storage/storage";

// Video của bài học thử cho khách (không cần đăng nhập): chỉ tệp gắn vào đúng bài học thử của khóa đang bán; có Range để tua.
export const GET = route(async (req: Request, ctx: { params: Promise<{ slug: string; position: string }> }) => {
  const { slug, position } = await ctx.params;
  const video = /^\d{1,3}$/.test(position) ? await trialVideo(slug, Number(position)) : null;
  if (!video) throw new HttpError(404, "Không tìm thấy video");
  const opened = await openProtected(video.storageKey);
  if (!opened) throw new HttpError(404, "Không tìm thấy video");
  return fileResponse(req, opened, video.mime);
});
