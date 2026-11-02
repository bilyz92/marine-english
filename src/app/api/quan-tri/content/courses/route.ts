import { json, readJson, route } from "@/lib/http";
import { createCourse, CreateCourse } from "@/modules/content/editor";
import { requireAdmin } from "@/modules/sessions/guards";

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  return json(await createCourse(ctx, await readJson(req, CreateCourse)));
});
