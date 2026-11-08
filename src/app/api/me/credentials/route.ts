import { json, route } from "@/lib/http";
import { credentialsForOrder } from "@/modules/auth-learner/pending-credentials";
import { requireLearner } from "@/modules/sessions/guards";

// Bước 3 của trang mua (đã báo chuyển khoản hoặc đã thanh toán): số điện thoại và mật khẩu tạm của khách vừa được tạo tài khoản.
const NO_STORE = { "cache-control": "no-store, private" };

export const GET = route(async (req: Request) => {
  const learner = await requireLearner(req);
  const code = new URL(req.url).searchParams.get("order") ?? "";
  const found = code ? await credentialsForOrder(learner, code) : null;
  return json(found ? { available: true, ...found } : { available: false }, { headers: NO_STORE });
});
