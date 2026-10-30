import { HttpError, json, route } from "@/lib/http";
import { getTrialLesson } from "@/modules/content/catalog";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ slug: string; position: string }> }) => {
  const { slug, position } = await ctx.params;
  const lesson = /^\d{1,3}$/.test(position) ? await getTrialLesson(slug, Number(position)) : null;
  if (!lesson) throw new HttpError(404, "Không tìm thấy bài học thử");
  return json(lesson);
});
