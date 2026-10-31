import { prisma } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requireLearner } from "@/modules/sessions/guards";

/** Học viên và thiết bị của phiên: app dùng để đặt tên kho dữ liệu offline theo người + máy. */
export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const user = await prisma().user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { displayName: true } });
  return json({ userId: ctx.userId, deviceId: ctx.deviceId, displayName: user.displayName });
});
