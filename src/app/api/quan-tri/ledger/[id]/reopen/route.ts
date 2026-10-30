import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { reopenTransfer } from "@/modules/ledger/match";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ reason: z.string().trim().min(1).max(1000) });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy giao dịch");
  const result = await reopenTransfer(admin, id, (await readJson(req, Body)).reason);
  return json({ result }, { status: result === "ok" ? 200 : 404 });
});
