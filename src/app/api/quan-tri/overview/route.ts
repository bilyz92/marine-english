import { HttpError, json, route } from "@/lib/http";
import { overview } from "@/modules/admin/overview";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const days = Number(new URL(req.url).searchParams.get("days") ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new HttpError(400, "Khoảng ngày không hợp lệ");
  return json(await overview(ctx, days));
});
