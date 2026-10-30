import { json, route } from "@/lib/http";
import { listMyCourses } from "@/modules/enrollments/access";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  return json({ courses: await listMyCourses(ctx.userId) });
});
