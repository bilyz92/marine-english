import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { setLessonModule } from "@/modules/content/modules";
import { requireAdmin } from "@/modules/sessions/guards";

/** Xếp bài vào module của khóa. */
const Body = z.object({ moduleId: z.uuid() });

export const PUT = route(async (req: Request, { params }: { params: Promise<{ slug: string; externalId: string }> }) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  const body = await readJson(req, Body);
  await setLessonModule(ctx, slug, decodeURIComponent(externalId), body.moduleId);
  return json({ ok: true });
});
