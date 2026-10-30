import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { requireAdmin } from "@/modules/sessions/guards";

const Body = z.object({ sourceUserId: z.uuid(), targetUserId: z.uuid(), reason: z.string().trim().min(1).max(1000), preview: z.boolean().default(true) });

/** Mặc định chỉ xem trước; gửi preview=false để gộp thật. */
export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const result = await mergeAccounts(ctx, await readJson(req, Body));
  if (result === "invalid") return json({ error: "invalid" }, { status: 409 });
  return json(result === "merged" ? { result } : { preview: result });
});
