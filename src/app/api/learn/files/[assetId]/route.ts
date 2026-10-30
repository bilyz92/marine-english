import { Readable } from "node:stream";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { canReadAsset } from "@/modules/learn/entitlements";
import { requireLearner } from "@/modules/sessions/guards";
import { openProtected } from "@/modules/storage/storage";

// Tệp được bảo vệ chỉ tải qua đây (TD §7): đường dẫn luôn tra từ DB theo id, không bao giờ lấy từ client.

/** Trả đoạn [start, end] theo header Range; không có Range → null; sai cú pháp hoặc ngoài kích thước → "invalid". */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (header === null) return null;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start >= size || end < start ? "invalid" : { start, end };
}

export const GET = route(async (req: Request, ctx: { params: Promise<{ assetId: string }> }) => {
  const learner = await requireLearner(req);
  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) throw new HttpError(404, "Không tìm thấy tệp");
  const asset = await prisma().mediaAsset.findUnique({ where: { id: assetId }, select: { mime: true, storageKey: true } });
  if (!asset) throw new HttpError(404, "Không tìm thấy tệp");
  if (!(await canReadAsset(learner.userId, assetId))) throw new HttpError(403, "Chưa có quyền tải tệp này");
  const opened = await openProtected(asset.storageKey);
  if (!opened) throw new HttpError(404, "Không tìm thấy tệp");

  const { handle, size } = opened;
  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    await handle.close();
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  // Client ngắt thì luồng web bị hủy, kéo theo hủy luồng đọc và đóng tệp.
  const body = Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })) as ReadableStream;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      "content-type": asset.mime,
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
});
