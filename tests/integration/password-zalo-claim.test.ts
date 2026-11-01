import { describe, expect, it, vi } from "vitest";

// Tệp riêng để bật đăng nhập bằng số (Zalo) trước khi env() được đọc lần đầu: liên kết số chỉ chạy khi Zalo bật (sau G6).
vi.hoisted(() => {
  process.env.ZALO_LOGIN_ENABLED = "true";
});

import { prisma, withTx } from "@/lib/db";
import { completeLinkOtp } from "@/modules/auth-learner/link";
import { issueOtp } from "@/modules/auth-learner/otp";
import { registerWithPassword } from "@/modules/auth-learner/password";
import { testLearner } from "../helpers/learner-ctx";

describe("liên kết số đã xác minh nhả dòng mật khẩu chưa xác minh (D2)", () => {
  it("học viên khác liên kết số đó bằng mã gửi tới số → dòng mật khẩu của người kia bị nhả", async () => {
    const created = await registerWithPassword(
      { phone: "0912345678", password: "Thuyenvien2026", displayName: "Người chiếm số", rank: null, ip: "10.0.0.8" },
      async () => null,
    );
    expect(created.kind).toBe("ok");
    const other = await testLearner("Chủ số thật");
    let code = "";
    await issueOtp(
      { purpose: "link", kind: "phone", value: "+84912345678", ip: "10.0.0.7", userId: other.userId, create: true },
      { send: async (_kind, _value, c) => { code = c; } },
    );
    expect(await completeLinkOtp(other, { kind: "phone", contact: "0912345678", code })).toBe("linked");
    expect((await prisma().passwordLogin.findFirstOrThrow()).releasedAt).not.toBeNull();
    expect(await withTx((tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM password_logins WHERE released_at IS NULL`)).toEqual([{ n: 0 }]);
  });
});
