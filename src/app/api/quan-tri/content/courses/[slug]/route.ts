import { json, route } from "@/lib/http";
import { courseLessons } from "@/modules/content/editor";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireAdmin(req);
  return json(await courseLessons(ctx, (await params).slug));
});
