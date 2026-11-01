import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "@/modules/auth-learner/password-hash";

describe("băm mật khẩu (scrypt)", () => {
  it("định dạng scrypt$15$8$1$muối$băm, mỗi lần một muối khác", async () => {
    const a = await hashPassword("mat khau dai 1");
    const b = await hashPassword("mat khau dai 1");
    expect(a).toMatch(/^scrypt\$15\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(a).not.toBe(b);
  });

  it("đúng mật khẩu → true; sai, chuỗi băm hỏng → false", async () => {
    const stored = await hashPassword("Thuyenvien2026");
    expect(await verifyPassword("Thuyenvien2026", stored)).toBe(true);
    expect(await verifyPassword("thuyenvien2026", stored)).toBe(false);
    expect(await verifyPassword("Thuyenvien2026", "scrypt$15$8$1$abc")).toBe(false);
    expect(await verifyPassword("Thuyenvien2026", "bcrypt$x")).toBe(false);
  });
});

describe("chính sách mật khẩu", () => {
  const phone = "+84912345678";
  it.each([
    ["1234567", "too_short"],
    ["x".repeat(129), "too_long"],
    ["12345678", "common"],
    ["Password", "common"],
    ["0912345678", "phone"],
    ["912345678", "phone"],
    ["Thuyenvien2026", null],
    ["máy chính 8 chữ", null],
  ])("%s → %s", (pw, problem) => {
    expect(passwordProblem(pw, phone)).toBe(problem);
  });
});
