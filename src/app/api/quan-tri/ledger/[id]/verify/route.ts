import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { verifyStatementLine } from "@/modules/ledger/manual";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ evidence: z.string().trim().min(1).max(2000) });
const STATUS = { verified: 200, already_verified: 409, self_entered: 403, not_found: 404 } as const;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy giao dịch");
  const result = await verifyStatementLine(admin, id, (await readJson(req, Body)).evidence);
  return json(result, { status: STATUS[result.result] });
});
