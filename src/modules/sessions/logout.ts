import { withTx } from "@/lib/db";
import { HttpError, json, readBody, route, withCookies } from "@/lib/http";
import { revokeDevice } from "@/modules/auth-learner/devices";
import { clearSessionCookies } from "./cookies";
import { requireAdmin, requireLearner } from "./guards";
import { revokeSession, type Realm } from "./sessions";

/**
 * Đăng xuất một khu vực: thu hồi phiên của khu vực đó (nếu có) và xóa cookie; khu vực kia giữ nguyên.
 * Học viên gửi { switchAccount: true } khi đổi sang tài khoản khác trên cùng bản cài: thu hồi luôn thiết bị hiện tại
 * (client sẽ sinh khóa thiết bị mới). Đăng xuất bình thường giữ thiết bị để đăng nhập lại không tốn chỗ.
 */
export function logoutHandler(realm: Realm) {
  return route(async (req: Request) => {
    try {
      if (realm === "admin") {
        const { sessionId } = await requireAdmin(req);
        await withTx((tx) => revokeSession(tx, "admin", sessionId));
      } else {
        const { sessionId, deviceId } = await requireLearner(req);
        const body = (await readBody(req)) as { switchAccount?: unknown } | undefined;
        await withTx(async (tx) => {
          await revokeSession(tx, "learner", sessionId);
          if (body?.switchAccount === true) await revokeDevice(tx, deviceId);
        });
      }
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 401)) throw error;
    }
    return withCookies(json({ ok: true }), clearSessionCookies(realm));
  });
}
