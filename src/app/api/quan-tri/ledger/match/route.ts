import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { matchTransfers } from "@/modules/ledger/match";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({
  orderCode: z.string().max(20),
  bankTransactionIds: z.array(z.uuid()).min(1).max(10),
  note: z.string().trim().min(1).max(1000),
  evidence: z.string().trim().min(1).max(2000),
});

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const result = await matchTransfers(ctx, await readJson(req, Body));
  return json(result, { status: result.result === "rejected" ? 409 : 200 });
});
