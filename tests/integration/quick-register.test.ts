import { describe, expect, it } from "vitest";
import { withTx } from "@/lib/db";
import { POST as quickRoute } from "@/app/api/auth/learner/password/quick-register/route";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { createUserWithIdentity } from "@/modules/auth-learner/identities";
import { cookieValue, newDeviceKey, ORIGIN } from "../helpers/learner";
import { sqlAsMigrator } from "../helpers/otp";

// Mua khóa không cần đăng nhập trước (docs/superpowers/plans/2026-11-05-guest-checkout.md, Task 1):
// tên + số (email tùy chọn) → tạo tài khoản, mật khẩu do hệ thống cấp, trả về một lần.

const DEVICE = newDeviceKey();
let ipSeq = 0;
const freshIp = () => `10.8.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

async function quick(body: Record<string, unknown>, opts: { ip?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? freshIp() };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await quickRoute(new Request(`${ORIGIN}/api/auth/learner/password/quick-register`, {
    method: "POST", headers, body: JSON.stringify({ displayName: "Khách mua nhanh", deviceKey: DEVICE, deviceLabel: "Máy", ...body }),
  }));
  return { status: res.status, cache: res.headers.get("cache-control") ?? "", body: (await res.json()) as Record<string, string>, session: cookieValue(res, "__Host-me_learn") };
}

async function login(phone: string, password: string) {
  const res = await loginRoute(new Request(`${ORIGIN}/api/auth/learner/password/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ phone, password, deviceKey: DEVICE, deviceLabel: "Máy" }),
  }));
  return (await res.json()) as { next?: string; error?: string };
}

describe("đăng ký nhanh ở trang mua", () => {
  it("số mới → tạo tài khoản, có phiên, không trả mật khẩu (hiện ở bước 3); mật khẩu tạm bắt đổi khi đăng nhập; không lưu đệm", async () => {
    const r = await quick({ phone: "0912 000 111" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ next: "done" });
    expect(r.session).toBeTruthy();
    expect(r.cache).toContain("no-store");
    const { rows } = await sqlAsMigrator(`SELECT must_change FROM password_logins WHERE phone_canonical = '+84912000111'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].must_change).toBe(true);
    expect((await login("0912000111", "khong-phai-mat-khau")).next).toBe("invalid");
  });

  it("số đã có tài khoản → 409 phone_taken, không trả mật khẩu, không tạo tài khoản thứ hai", async () => {
    expect((await quick({ phone: "0912000222" })).status).toBe(200);
    const again = await quick({ phone: "+84912000222", displayName: "Người khác" });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "phone_taken" });
    expect(again.cache).toContain("no-store");
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_logins WHERE phone_canonical = '+84912000222'`);
    expect(rows[0].n).toBe(1);
  });

  it("số đã xác minh của tài khoản khác (không có mật khẩu) cũng là phone_taken", async () => {
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84912000333", displayName: "Có Zalo", rank: null }));
    expect((await quick({ phone: "0912000333" })).body).toEqual({ error: "phone_taken" });
  });

  it("email trùng email đã xác minh của tài khoản khác → 409 email_taken, không tạo tài khoản", async () => {
    await withTx((tx) => createUserWithIdentity(tx, { kind: "email", value: "co-tai-khoan@x.vn", displayName: "Có email", rank: null }));
    const r = await quick({ phone: "0912000444", email: " Co-Tai-Khoan@X.vn " });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: "email_taken" });
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_logins WHERE phone_canonical = '+84912000444'`);
    expect(rows[0].n).toBe(0);
  });

  it("email mới → tạo tài khoản; email chưa xác minh nên không lưu vào user_identities", async () => {
    const r = await quick({ phone: "0912000555", email: "moi@x.vn" });
    expect(r.status).toBe(200);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM user_identities WHERE value_canonical = 'moi@x.vn'`);
    expect(rows[0].n).toBe(0);
  });

  it("số sai → 400 invalid_phone; email sai dạng → 400 invalid_email; tên trống → 400", async () => {
    const badPhone = await quick({ phone: "123" });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.error).toBe("invalid_phone");
    expect(badPhone.cache).toContain("no-store");
    const badEmail = await quick({ phone: "0912000666", email: "khong-phai-email" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe("invalid_email");
    const noName = await quick({ phone: "0912000777", displayName: "  " });
    expect(noName.status).toBe(400);
    expect(noName.cache).toContain("no-store");
    const noDevice = await quick({ phone: "0912000778", deviceKey: "ngan" });
    expect(noDevice.status).toBe(400);
    expect(noDevice.cache).toContain("no-store");
  });

  it("dùng chung hạn mức đăng ký theo IP → 429 throttled", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await quick({ phone: `09130001${10 + i}` }, { ip })).status).toBe(200);
    const r = await quick({ phone: "0913000199" }, { ip });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("throttled");
  });

  it("không có Origin cùng site → 403, không tạo gì", async () => {
    const r = await quick({ phone: "0912000888" }, { origin: "https://ke-gian.example" });
    expect(r.status).toBe(403);
    expect(r.cache).toContain("no-store");
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_logins WHERE phone_canonical = '+84912000888'`);
    expect(rows[0].n).toBe(0);
  });
});
