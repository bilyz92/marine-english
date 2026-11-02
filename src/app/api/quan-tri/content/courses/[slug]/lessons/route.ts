import { json, readJson, route } from "@/lib/http";
import { ContentConflict } from "@/modules/content/authoring";
import { saveLesson, SaveLesson } from "@/modules/content/editor";
import { requireAdmin } from "@/modules/sessions/guards";

/** Thêm bài cuối khóa. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireAdmin(req);
  const body = await readJson(req, SaveLesson);
  try {
    return json(await saveLesson(ctx, (await params).slug, null, body));
  } catch (error) {
    if (error instanceof ContentConflict) return json({ error: error.code, courses: error.courses }, { status: 409 });
    throw error;
  }
});
