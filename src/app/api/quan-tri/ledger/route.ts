import { json, readBody, route } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import { enterStatementLine, type StatementLineInput } from "@/modules/ledger/manual";
import { listQueue, listUnresolved } from "@/modules/ledger/queue";
import { requireAdmin } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "orders.view", { action: "ledger_queue_view" });
  return json({ queue: await listQueue(), unresolved: await listUnresolved() });
});

/** Nhập một dòng sao kê (kiểm dữ liệu trong enterStatementLine). */
export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const outcome = await enterStatementLine(ctx, (await readBody(req)) as StatementLineInput);
  return json({ outcome });
});
