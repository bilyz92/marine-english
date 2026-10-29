import { prisma } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { unlinkIdentity } from "@/modules/auth-learner/link";
import { requireLearner } from "@/modules/sessions/guards";

export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const identities = await prisma().userIdentity.findMany({
    where: { userId: ctx.userId },
    select: { id: true, kind: true, valueCanonical: true, verifiedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return json({ identities });
});

const STATUS = { unlinked: 200, reauth_required: 403, last_identity: 409, not_found: 404 } as const;

export const DELETE = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Thiếu mã định danh");
  const result = await unlinkIdentity(ctx, id);
  return json({ result }, { status: STATUS[result] });
});
