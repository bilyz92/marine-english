import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { lessonContent } from "@/modules/learn/lessons";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request, ctx: { params: Promise<{ lessonVersionId: string }> }) => {
  const learner = await requireLearner(req);
  const { lessonVersionId } = await ctx.params;
  if (!z.uuid().safeParse(lessonVersionId).success) throw new HttpError(404, "Không tìm thấy bài học");
  const result = await lessonContent(learner, lessonVersionId);
  if (result === "not_found") throw new HttpError(404, "Không tìm thấy bài học");
  if (result === "forbidden") throw new HttpError(403, "Chưa có quyền học bài này");
  return json(result, { headers: { "cache-control": "private, no-store" } });
});
