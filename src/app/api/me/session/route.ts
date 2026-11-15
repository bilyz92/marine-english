import { prisma } from "@/lib/db";
import { json, route } from "@/lib/http";
import { requireLearner } from "@/modules/sessions/guards";

/**
 * Học viên và thiết bị của phiên: app dùng để đặt tên kho dữ liệu offline theo người + máy.
 * accountLabel: chữ trên nút Tài khoản ở đầu trang (chủ 15/11/2026): email đã xác minh, rồi email liên hệ, rồi số điện thoại, rồi tên.
 */
export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const user = await prisma().user.findUniqueOrThrow({
    where: { id: ctx.userId },
    select: {
      displayName: true,
      identities: { where: { kind: "email" }, select: { valueCanonical: true }, orderBy: { createdAt: "asc" }, take: 1 },
      contactEmail: { select: { email: true } },
      passwordLogin: { select: { phoneCanonical: true, releasedAt: true } },
    },
  });
  // Số lưu dạng +84…; trên nút ghi dạng quen thuộc 0….
  const stored = user.passwordLogin && !user.passwordLogin.releasedAt ? user.passwordLogin.phoneCanonical : null;
  const phone = stored?.startsWith("+84") ? `0${stored.slice(3)}` : stored;
  const accountLabel = user.identities[0]?.valueCanonical ?? user.contactEmail?.email ?? phone ?? user.displayName;
  return json({ userId: ctx.userId, deviceId: ctx.deviceId, displayName: user.displayName, accountLabel });
});
