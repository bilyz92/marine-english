import { HttpError, json, route } from "@/lib/http";
import { hasCourseAccessBySlug } from "@/modules/enrollments/access";
import { requireLearner } from "@/modules/sessions/guards";

/** Đã có khóa chưa (trang khóa đổi nút mua thành “Vào học”). Không đọc đơn hay hàng chờ giao dịch. */
export const GET = route(async (req: Request) => {
  const ctx = await requireLearner(req);
  const course = new URL(req.url).searchParams.get("course") ?? "";
  if (!course || course.length > 100) throw new HttpError(400, "Thiếu khóa học");
  return json({ enrolled: await hasCourseAccessBySlug(ctx.userId, course) }, { headers: { "cache-control": "private, no-store" } });
});
