import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/http";
import { PayoutSchema, requestTransferRefund } from "@/modules/refunds/refunds";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ reason: z.string().trim().min(1).max(1000), payout: PayoutSchema.optional() });
const STATUS = { already_settled: 409, not_verified: 409, not_found: 404 } as const;

/** Đề nghị hoàn trọn một khoản chuyển đang ở hàng chờ (chưa ghép đơn). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin(req);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Không tìm thấy giao dịch");
  const result = await requestTransferRefund(admin, { bankTransactionId: id, ...(await readJson(req, Body)) });
  if ("refundId" in result) return json(result, { status: 201 });
  return json({ error: result.rejected }, { status: STATUS[result.rejected] });
});
