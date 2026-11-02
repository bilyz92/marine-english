import { HttpError, json, route } from "@/lib/http";
import { authorize } from "@/modules/auth-admin/authorize";
import { ContentConflict, importUpload } from "@/modules/content/authoring";
import { PACKAGE_LIMITS } from "@/modules/content/package";
import { requireAdmin } from "@/modules/sessions/guards";

// Thân là bytes thô của tệp (zip/json/docx). Đường dẫn này không qua src/proxy.ts (proxy đệm thân, giới hạn 10 MB):
// handler tự kiểm phiên, CSRF, quyền chủ và kích thước. nginx giới hạn 16 MB cho đúng đường dẫn này.
export const POST = route(async (req: Request) => {
  const ctx = await requireAdmin(req);
  await authorize(ctx, "content.edit", { action: "content_import" });
  const url = new URL(req.url);
  const file = (url.searchParams.get("file") ?? "").slice(0, 200);
  if (!file) throw new HttpError(400, "Thiếu tên tệp");
  const declared = req.headers.get("content-length");
  if (declared === null) throw new HttpError(411, "Thiếu độ dài tệp");
  if (Number(declared) > PACKAGE_LIMITS.maxUploadBytes) throw new HttpError(413, "Tệp lớn hơn 16 MB");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > PACKAGE_LIMITS.maxUploadBytes) throw new HttpError(413, "Tệp lớn hơn 16 MB");
  try {
    return json(
      await importUpload(ctx, bytes, file, {
        apply: url.searchParams.get("apply") === "1",
        confirmLive: url.searchParams.get("confirmLive") === "1",
        receipt: req.headers.get("x-preview-receipt"),
      }),
    );
  } catch (error) {
    if (error instanceof ContentConflict) return json({ error: error.code, courses: error.courses }, { status: 409 });
    throw error;
  }
});
