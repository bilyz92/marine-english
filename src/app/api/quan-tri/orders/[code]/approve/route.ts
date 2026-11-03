import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { approveTransfer } from "@/modules/orders/claims";
import { requireAdmin } from "@/modules/sessions/guards";

// Giờ chuyển khoản trên sao kê, bắt buộc có múi giờ (ví dụ +07:00).
const Body = z.object({
  bankRef: z.string().max(100).default(""),
  note: z.string().max(500).default(""),
  bankTime: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
});

// Chủ "Duyệt": đã thấy tiền của đơn trong app ngân hàng.
export const POST = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const admin = await requireAdmin(req);
  const body = await readJson(req, Body);
  const result = await approveTransfer(admin, { orderCode: (await ctx.params).code, ...body });
  return json(result, { status: result.result === "rejected" ? 409 : 200 });
});
