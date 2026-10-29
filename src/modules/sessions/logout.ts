import { withTx } from "@/lib/db";
import { HttpError, json, route, withCookies } from "@/lib/http";
import { clearSessionCookies } from "./cookies";
import { requireAdmin, requireLearner } from "./guards";
import { revokeSession, type Realm } from "./sessions";

/** Đăng xuất một khu vực: thu hồi phiên của khu vực đó (nếu có) và xóa cookie; khu vực kia giữ nguyên. */
export function logoutHandler(realm: Realm) {
  return route(async (req: Request) => {
    try {
      const { sessionId } = realm === "admin" ? await requireAdmin(req) : await requireLearner(req);
      await withTx((tx) => revokeSession(tx, realm, sessionId));
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) throw error;
    }
    return withCookies(json({ ok: true }), clearSessionCookies(realm));
  });
}
