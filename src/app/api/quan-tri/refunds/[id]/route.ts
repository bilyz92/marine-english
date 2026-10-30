import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { advanceRefund } from "@/modules/refunds/refunds";
import { requireAdmin } from "@/modules/sessions/guards";

const Step = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("send"), outBankRef: z.string().trim().min(1).max(100), evidence: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("fail"), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(1).max(1000) }),
]);
const STATUS = { ok: 200, invalid_transition: 409, duplicate_out_ref: 409, not_found: 404 } as const;

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy yêu cầu hoàn tiền");
  const result = await advanceRefund(admin, id, await readJson(req, Step));
  return json({ result }, { status: STATUS[result] });
});
