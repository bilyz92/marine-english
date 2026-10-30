import { z } from "zod";
import { json, readJson, route } from "@/lib/http";
import { grantCourse, revokeGrant } from "@/modules/enrollments/grants";
import { requireAdmin } from "@/modules/sessions/guards";

const Grant = z.object({ userId: z.uuid(), courseId: z.uuid(), reason: z.string().trim().min(1).max(1000) });
const Revoke = z.object({ enrollmentId: z.uuid(), reason: z.string().trim().min(1).max(1000) });

export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const result = await grantCourse(ctx, await readJson(req, Grant));
  return json(result, { status: result.result === "granted" ? 201 : 404 });
});

/** Thu hồi quyền đã cấp không thu tiền. */
export const PATCH = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  const { enrollmentId, reason } = await readJson(req, Revoke);
  const result = await revokeGrant(ctx, enrollmentId, reason);
  return json({ result }, { status: result === "revoked" ? 200 : 404 });
});
