import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { adminResetPassword } from "@/modules/auth-learner/password";
import { readPendingCredentials } from "@/modules/auth-learner/pending-credentials";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { adminCtx } from "../helpers/admin-ctx";
import { issuedLearner } from "../helpers/guest";
import { newDeviceKey, ORIGIN } from "../helpers/learner";
import { testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

// Mật khẩu tạm của học viên tạo từ đơn khách (chủ 09/11 và 16/11/2026): chỉ gửi qua email; bản chờ (niêm phong) mất khi mật khẩu đổi.

let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

async function login(phone: string, password: string, newPassword?: string) {
  const res = await loginRoute(new Request(`${ORIGIN}/api/auth/learner/password/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ phone, password, deviceKey: newDeviceKey(), deviceLabel: "Máy khác", ...(newPassword ? { newPassword } : {}) }),
  }));
  return (await res.json()) as { next?: string; error?: string };
}

describe("mật khẩu tạm của học viên tạo từ đơn khách", () => {
  it("mật khẩu tạm bắt đổi; DB chỉ có bản băm và bản mã hóa; đặt mật khẩu mới thì bản chờ mất", async () => {
    const userId = await issuedLearner("0915000101");
    const creds = await readPendingCredentials(userId);
    expect(creds?.phone).toBe("0915000101");
    const { rows: [row] } = await sqlAsMigrator(
      `SELECT l.password_hash, p.password_enc FROM password_logins l JOIN learner_pending_credentials p ON p.user_id = l.user_id WHERE l.user_id = $1`, [userId]);
    expect(row.password_hash).not.toContain(creds!.password);
    expect(row.password_enc).not.toContain(creds!.password);
    expect(await login("0915000101", creds!.password)).toEqual({ next: "set_password" });
    expect((await login("0915000101", creds!.password, "Thuyen vien moi 2026")).next).toBe("done");
    expect(await readPendingCredentials(userId)).toBeNull();
    expect(await prisma().learnerPendingCredentials.count({ where: { userId } })).toBe(0);
  });

  it("chủ đặt mật khẩu tạm mới → bản chờ cũ bị bỏ", async () => {
    const userId = await issuedLearner("0915000707");
    expect(await readPendingCredentials(userId)).not.toBeNull();
    const r = await adminResetPassword(await adminCtx("owner"), userId, { reason: "Khách quên", evidence: "Gọi điện xác nhận" });
    expect(r.kind).toBe("ok");
    expect(await readPendingCredentials(userId)).toBeNull();
  });

  it("gộp tài khoản (nguồn có số + mật khẩu tạm, đích chưa có) → bản chờ của nguồn bị bỏ", async () => {
    const source = await issuedLearner("0915000808");
    const target = await testLearner("Tài khoản chính");
    expect(await mergeAccounts(await adminCtx("owner"), { sourceUserId: source, targetUserId: target.userId, reason: "khách có hai tài khoản", preview: false })).toBe("merged");
    expect(await readPendingCredentials(source)).toBeNull();
    expect(await readPendingCredentials(target.userId)).toBeNull();
  });
});
