import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import { requireAdmin } from "@/modules/sessions/guards";

// Khung bài giảng mẫu (Excel) để tải về; tệp dựng bằng scripts/build-lesson-template.mjs, đóng gói qua outputFileTracingIncludes (next.config.ts).
const TEMPLATE_FILE = "khung-bai-giang-mau.xlsx";

export const GET = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "orders.view", { action: "content_template" });
  const bytes = await readFile(join(process.cwd(), "src/assets", TEMPLATE_FILE));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${TEMPLATE_FILE}"`,
      "cache-control": "no-store",
    },
  });
});
