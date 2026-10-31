import { json, route } from "@/lib/http";
import { searchLearners } from "@/modules/admin/learners";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  return json({ learners: await searchLearners(ctx, new URL(req.url).searchParams.get("q") ?? "") });
});
