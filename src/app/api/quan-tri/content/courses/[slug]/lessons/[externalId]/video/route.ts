import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { listLessonVideo, removeLessonVideo, setLessonVideo } from "@/modules/content/lesson-video";
import { MAX_VIDEO_BYTES } from "@/modules/content/video-format";
import { requireAdmin } from "@/modules/sessions/guards";

// Tệp video của một bài (docs/superpowers/plans/2026-11-12-video-lessons.md). Đường dẫn này không qua src/proxy.ts (proxy đệm thân,
// giới hạn 10 MB): handler tự kiểm phiên, Origin, CSRF (requireAdmin), quyền và kích thước. nginx/Caddy cho phép 300 MB ở đúng đường dẫn này.

type Params = { params: Promise<{ slug: string; externalId: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  return json({ video: await listLessonVideo(ctx, slug, externalId) });
});

// Thân là bytes thô của tệp video, đọc theo luồng (không arrayBuffer/formData).
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  const declared = req.headers.get("content-length");
  if (declared === null) throw new HttpError(411, "Thiếu độ dài tệp");
  if (!/^\d+$/.test(declared) || Number(declared) > MAX_VIDEO_BYTES) throw new HttpError(413, "Tệp video lớn hơn 300 MB");
  if (!req.body) throw new HttpError(400, "Thiếu tệp video");
  return json(await setLessonVideo(ctx, slug, externalId, req.body));
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  const asset = new URL(req.url).searchParams.get("asset") ?? "";
  if (!z.uuid().safeParse(asset).success) throw new HttpError(404, "not_found");
  await removeLessonVideo(ctx, slug, externalId, asset);
  return json({ ok: true });
});
