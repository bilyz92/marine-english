import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { addLessonAudio, listLessonAudio, MAX_AUDIO_BYTES, removeLessonAudio } from "@/modules/content/lesson-audio";
import { requireAdmin } from "@/modules/sessions/guards";

type Params = { params: Promise<{ slug: string; externalId: string }> };

export const GET = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  return json({ audio: await listLessonAudio(ctx, slug, externalId) });
});

// Multipart, trường "audio".
export const POST = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_AUDIO_BYTES + 64 * 1024) throw new HttpError(413, "Tệp ghi âm cần nhỏ hơn 4 MB");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Không đọc được tệp gửi lên");
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw new HttpError(400, "Thiếu tệp ghi âm");
  return json(await addLessonAudio(ctx, slug, externalId, Buffer.from(await audio.arrayBuffer())));
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const { slug, externalId } = await params;
  const asset = new URL(req.url).searchParams.get("asset") ?? "";
  if (!z.uuid().safeParse(asset).success) throw new HttpError(404, "not_found");
  await removeLessonAudio(ctx, slug, externalId, asset);
  return json({ ok: true });
});
