import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { setDisposition } from "@/modules/ledger/match";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ kind: z.enum(["duplicate", "ignored"]), reason: z.string().trim().min(1).max(1000) });
const STATUS = { ok: 200, already_settled: 409, not_found: 404 } as const;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy giao dịch");
  const result = await setDisposition(admin, id, await readJson(req, Body));
  return json({ result }, { status: STATUS[result] });
});
