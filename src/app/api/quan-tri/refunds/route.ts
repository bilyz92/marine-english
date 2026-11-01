import { z } from "zod";
import { prisma } from "@/lib/db";
import { json, readJson, route } from "@/lib/http";
import { authorize, permissionsFor } from "@/modules/auth-admin/authorize";
import { maskAccountNo, PayoutSchema, requestFullRefund } from "@/modules/refunds/refunds";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "orders.view", { action: "refunds_list" });
  const refunds = await prisma().refund.findMany({ orderBy: { requestedAt: "desc" }, include: { order: { select: { code: true } }, sources: true } });
  // Số tài khoản nhận tiền đầy đủ chỉ cho người duyệt và chuyển tiền (chủ); hỗ trợ thấy 4 số cuối.
  const full = permissionsFor(ctx).includes("refunds.approve");
  return json({ refunds: refunds.map((r) => ({ ...r, payoutAccountNo: r.payoutAccountNo && !full ? maskAccountNo(r.payoutAccountNo) : r.payoutAccountNo })) });
});

const Body = z.object({ orderCode: z.string().max(20), reason: z.string().trim().min(1).max(1000), payout: PayoutSchema.optional() });

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const result = await requestFullRefund(ctx, await readJson(req, Body));
  return json(result, { status: "refundId" in result ? 201 : 409 });
});
