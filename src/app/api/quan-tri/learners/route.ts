import { json, route } from "@/lib/http";
import { listLearners, searchLearners } from "@/modules/admin/learners";
import { requireAdmin } from "@/modules/sessions/guards";

// ?q=… tìm; ?list=1 (không từ khóa) liệt kê mới nhất trước, có tổng số và con trỏ trang sau.
export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const url = new URL(req.url);
  if (url.searchParams.get("list") === "1") {
    return json(await listLearners(ctx, { limit: Number(url.searchParams.get("limit") ?? 50) || 50, cursor: url.searchParams.get("cursor") }));
  }
  return json({ learners: await searchLearners(ctx, url.searchParams.get("q") ?? "") });
});
