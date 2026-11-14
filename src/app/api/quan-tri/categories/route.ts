import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { CATEGORY_TITLE_MAX, createCategory, listCategories } from "@/modules/content/categories";
import { requireAdmin } from "@/modules/sessions/guards";

// Danh mục khóa học (docs/superpowers/plans/2026-11-14-course-categories.md).
const Body = z.object({
  titleVi: z.string().max(CATEGORY_TITLE_MAX * 2),
  titleEn: z.string().max(CATEGORY_TITLE_MAX * 2).nullable().optional(),
  parentId: z.uuid().nullable().optional(),
});

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  return json(await listCategories(ctx));
});

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  return json(await createCategory(ctx, await readJson(req, Body)));
});
