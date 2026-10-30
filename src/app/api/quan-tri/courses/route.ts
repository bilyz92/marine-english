import { json, route } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import { listAllCourses } from "@/modules/content/catalog";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "orders.view", { action: "courses_list" });
  return json({ courses: await listAllCourses() });
});
