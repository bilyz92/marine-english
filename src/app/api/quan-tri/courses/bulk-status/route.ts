import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { bulkCourseStatus } from "@/modules/content/catalog";
import { requireAdmin } from "@/modules/sessions/guards";

const Change = z.object({ status: z.enum(["published", "archived"]) });

export const POST = route(async (req: Request) => {
  const admin = await requireAdmin(req);
  return json(await bulkCourseStatus(admin, (await readJson(req, Change)).status));
});
