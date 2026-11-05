import { z } from "zod";
import { prisma } from "@/lib/db";
import { fileResponse } from "@/lib/file-response";
import { HttpError, route } from "@/lib/http";
import { canReadAsset } from "@/modules/learn/entitlements";
import { requireLearner } from "@/modules/sessions/guards";
import { openProtected } from "@/modules/storage/storage";

// Tệp được bảo vệ chỉ tải qua đây (TD §7): đường dẫn luôn tra từ DB theo id, không bao giờ lấy từ client.
export const GET = route(async (req: Request, ctx: { params: Promise<{ assetId: string }> }) => {
  const learner = await requireLearner(req);
  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) throw new HttpError(404, "Không tìm thấy tệp");
  const asset = await prisma().mediaAsset.findUnique({ where: { id: assetId }, select: { mime: true, storageKey: true } });
  if (!asset) throw new HttpError(404, "Không tìm thấy tệp");
  if (!(await canReadAsset(learner.userId, assetId))) throw new HttpError(403, "Chưa có quyền tải tệp này");
  const opened = await openProtected(asset.storageKey);
  if (!opened) throw new HttpError(404, "Không tìm thấy tệp");
  return fileResponse(req, opened, asset.mime);
});
