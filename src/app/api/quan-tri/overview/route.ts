import { HttpError, json, route } from "@/lib/http";
import { overview, rangeOfDates, rangeOfLastDays } from "@/modules/admin/overview";
import { requireAdmin } from "@/modules/sessions/guards";

/** ?days=N (N ngày gần nhất) hoặc ?from=YYYY-MM-DD&to=YYYY-MM-DD (ngày Việt Nam, gồm cả hai đầu, tối đa 366 ngày). */
export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const params = new URL(req.url).searchParams;
  if (params.has("from") || params.has("to")) {
    const range = rangeOfDates(params.get("from") ?? "", params.get("to") ?? "");
    if (!range) throw new HttpError(400, "Khoảng ngày không hợp lệ");
    return json(await overview(ctx, range));
  }
  const days = Number(params.get("days") ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new HttpError(400, "Khoảng ngày không hợp lệ");
  return json(await overview(ctx, rangeOfLastDays(days)));
});
