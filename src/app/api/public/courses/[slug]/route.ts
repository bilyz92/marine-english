import { HttpError, json, route } from "@/lib/http";
import { getPublishedCourse } from "@/modules/content/catalog";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const course = await getPublishedCourse((await ctx.params).slug);
  if (!course) throw new HttpError(404, "Không tìm thấy khóa học");
  return json(course);
});
