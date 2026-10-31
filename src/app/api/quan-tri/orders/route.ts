import { json, route } from "@/lib/http";
import { listOrders } from "@/modules/admin/orders";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const params = new URL(req.url).searchParams;
  return json(await listOrders(ctx, {
    status: params.get("status"), q: params.get("q"), cursor: params.get("cursor"), limit: Number(params.get("limit") ?? 50) || 50,
  }));
});
