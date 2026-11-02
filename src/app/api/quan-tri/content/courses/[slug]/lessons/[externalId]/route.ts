import { json, readJson, route } from "@/lib/http";
import { ContentConflict } from "@/modules/content/authoring";
import { lessonInCourse, saveLesson, SaveLesson } from "@/modules/content/editor";
import { requireAdmin } from "@/modules/sessions/guards";

type Params = { params: Promise<{ slug: string; externalId: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  return json(await lessonInCourse(ctx, slug, externalId));
});

/** Sửa bài: tạo phiên bản bài và phiên bản khóa mới. */
export const PUT = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  const body = await readJson(req, SaveLesson);
  try {
    return json(await saveLesson(ctx, slug, externalId, body));
  } catch (error) {
    if (error instanceof ContentConflict) return json({ error: error.code, courses: error.courses }, { status: 409 });
    throw error;
  }
});
