import { HttpError, json, route } from "@/lib/http";
import { courseManifest } from "@/modules/learn/manifest";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
  const learner = await requireLearner(req);
  const result = await courseManifest(learner, (await ctx.params).slug);
  if (result === "not_found") throw new HttpError(404, "Không tìm thấy khóa học");
  if (result === "forbidden") throw new HttpError(403, "Chưa có quyền học khóa này");
  return json(result);
});
