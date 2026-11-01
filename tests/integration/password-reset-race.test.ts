import { describe, expect, it, vi } from "vitest";

// Chen một thao tác vào đúng lúc đặt lại mật khẩu đang băm (giữa bước dùng mã và bước ghi mật khẩu mới).
const hook = vi.hoisted(() => ({ duringHash: null as null | (() => Promise<void>) }));
vi.mock("@/modules/auth-learner/password-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/auth-learner/password-hash")>();
  return {
    ...actual,
    hashPassword: async (password: string) => {
      const run = hook.duringHash;
      hook.duringHash = null;
      if (run) await run();
      return actual.hashPassword(password);
    },
  };
});

import { prisma } from "@/lib/db";
import { issueOtp } from "@/modules/auth-learner/otp";
import { adminResetPassword, registerWithPassword, resetPasswordWithCode } from "@/modules/auth-learner/password";
import { adminCtx } from "../helpers/admin-ctx";
import { sqlAsMigrator } from "../helpers/otp";

describe("đặt lại qua email không ghi đè mật khẩu vừa đổi ở chỗ khác", () => {
  it("chủ đặt mật khẩu tạm trong lúc học viên đặt lại → lần đặt lại trả invalid, mật khẩu tạm của chủ giữ nguyên", async () => {
    const created = await registerWithPassword(
      { phone: "0912345678", password: "Thuyenvien2026", displayName: "Học viên", rank: null, ip: "10.6.0.1" },
      async (_tx, userId) => userId,
    );
    if (created.kind !== "ok") throw new Error(created.kind);
    const userId = created.value;
    await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', 'a@x.vn', now())`, [userId]);
    let code = "";
    await issueOtp({ purpose: "reset", kind: "email", value: "a@x.vn", ip: "10.6.0.2", userId, create: true }, { send: async (_k, _v, c) => { code = c; } });

    let ownerHash = "";
    hook.duringHash = async () => {
      const r = await adminResetPassword(await adminCtx("owner"), userId, { reason: "khách gọi", evidence: "mã đơn MEAAAAAAAB" });
      if (r.kind !== "ok") throw new Error(r.kind);
      ownerHash = (await prisma().passwordLogin.findUniqueOrThrow({ where: { userId } })).passwordHash;
    };
    const result = await resetPasswordWithCode({ phone: "0912345678", code, newPassword: "Mat khau moi 2026", ip: "10.6.0.3" }, async () => "session");
    expect(result).toEqual({ kind: "invalid" });
    expect(await prisma().passwordLogin.findUniqueOrThrow({ where: { userId } })).toMatchObject({ passwordHash: ownerHash, mustChange: true });
  });
});
