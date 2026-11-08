import { z } from "zod";
import { HttpError, json, route } from "@/lib/http";
import { ContentConflict } from "@/modules/content/authoring";
import { importExcel, MAX_EXCEL_BYTES } from "@/modules/content/excel-import";
import { requireAdmin } from "@/modules/sessions/guards";

/** Tải lên khung bài giảng đã điền (thân là bytes thô của .xlsx). ?confirm=1 mới ghi; không có thì chỉ xem trước. */
export const POST = route(async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
  const ctx = await requireAdmin(req);
  const url = new URL(req.url);
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_EXCEL_BYTES) throw new HttpError(413, "file_too_large");
  const bytes = Buffer.from(await req.arrayBuffer());
  const version = url.searchParams.get("expectedVersionId");
  if (version && !z.uuid().safeParse(version).success) throw new HttpError(400, "Dữ liệu gửi lên không hợp lệ");
  const expectedVersionId = version || null;
  try {
    return json(await importExcel(ctx, (await params).slug, bytes, {
      confirm: url.searchParams.get("confirm") === "1",
      expectedVersionId,
      confirmLive: url.searchParams.get("confirmLive") === "1",
    }));
  } catch (error) {
    if (error instanceof ContentConflict) return json({ error: error.code, courses: error.courses }, { status: 409 });
    throw error;
  }
});
