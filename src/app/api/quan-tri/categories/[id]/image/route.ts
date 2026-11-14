import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { MAX_CATEGORY_IMAGE_BYTES, removeCategoryImage, setCategoryImage } from "@/modules/content/categories";
import { requireAdmin } from "@/modules/sessions/guards";

// Ảnh đại diện của danh mục: thân là bytes thô (jpg/png/webp ≤ 2 MB). Đi qua src/proxy.ts (đệm tới 10 MB, đủ cho 2 MB);
// requireAdmin kiểm phiên, Origin, CSRF; dịch vụ kiểm quyền, số byte thật và định dạng theo byte đầu tệp.
type Params = { params: Promise<{ id: string }> };

async function idOf(params: Params["params"]): Promise<string> {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "not_found");
  return id;
}

export const PUT = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  const id = await idOf(params);
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_CATEGORY_IMAGE_BYTES)) throw new HttpError(413, "image_too_large");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, "image_format");
  return json(await setCategoryImage(ctx, id, bytes));
});

export const DELETE = route(async (req: Request, { params }: Params) => {
  const ctx = await requireAdmin(req);
  await removeCategoryImage(ctx, await idOf(params));
  return json({ ok: true });
});
