import { HttpError, json, route } from "@/lib/http";
import { MAX_PROOF_BYTES, submitProof } from "@/modules/orders/claims";
import { requireLearner } from "@/modules/sessions/guards";

// Ảnh chứng minh đã chuyển khoản: multipart với trường "image" (ảnh) và "message" (lời nhắn, không bắt buộc).
export const POST = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const learner = await requireLearner(req);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PROOF_BYTES + 64 * 1024) throw new HttpError(413, "Ảnh cần nhỏ hơn 4 MB");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Không đọc được ảnh gửi lên");
  }
  const image = form.get("image");
  if (!(image instanceof Blob)) throw new HttpError(400, "Thiếu ảnh");
  const message = form.get("message");
  return json(await submitProof(learner, (await ctx.params).code.toUpperCase(), {
    message: typeof message === "string" ? message : "",
    bytes: Buffer.from(await image.arrayBuffer()),
  }));
});
