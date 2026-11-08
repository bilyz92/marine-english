import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { POST as registerRoute } from "@/app/api/auth/learner/password/register/route";
import { createUserWithIdentity } from "@/modules/auth-learner/identities";
import { claimVerifiedPhone } from "@/modules/auth-learner/password";
import { cookieValue, newDeviceKey, ORIGIN } from "../helpers/learner";
import { sqlAsMigrator } from "../helpers/otp";
import { JOBS } from "@/modules/jobs/definitions";

// D2: đăng ký và đăng nhập bằng số điện thoại + mật khẩu (docs/superpowers/plans/2026-11-01-phone-password.md).

const PW = "Thuyenvien2026";
// Mặc định mọi lần vào dùng cùng một máy, để không vướng giới hạn 2 máy (test riêng cho giới hạn đó).
const DEVICE = newDeviceKey();
let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

function req(path: string, body: unknown, ip: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function call(route: (r: Request) => Promise<Response>, path: string, body: unknown, ip: string) {
  const res = await route(req(path, body, ip));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, session: cookieValue(res, "__Host-me_learn") };
}

const register = (phone: string, opts: { password?: string; ip?: string; deviceKey?: string } = {}) =>
  call(registerRoute, "/api/auth/learner/password/register", {
    phone, password: opts.password ?? PW, displayName: "Trần Văn Máy", rank: "Thợ máy", deviceKey: opts.deviceKey ?? DEVICE, deviceLabel: "Điện thoại",
  }, opts.ip ?? freshIp());

const login = (phone: string, password: string, opts: { ip?: string; deviceKey?: string; newPassword?: string } = {}) =>
  call(loginRoute, "/api/auth/learner/password/login", {
    phone, password, deviceKey: opts.deviceKey ?? DEVICE, deviceLabel: "Điện thoại", ...(opts.newPassword ? { newPassword: opts.newPassword } : {}),
  }, opts.ip ?? freshIp());

const ageAttempts = (ms: number) => sqlAsMigrator(`UPDATE password_attempts SET at = at - ($1 || ' milliseconds')::interval`, [String(ms)]);

describe("đăng ký bằng số + mật khẩu", () => {
  it("tạo tài khoản và phiên; số lưu dạng +84 chưa xác minh, không vào user_identities; mọi cách viết số là một", async () => {
    const r = await register("0912 345 678");
    expect(r).toMatchObject({ status: 200, body: { next: "done" } });
    expect(r.session).toBeTruthy();
    const row = await prisma().passwordLogin.findFirstOrThrow();
    expect(row).toMatchObject({ phoneCanonical: "+84912345678", phoneVerifiedAt: null, releasedAt: null, mustChange: false });
    expect(row.passwordHash).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(await prisma().userIdentity.count()).toBe(0);
    for (const phone of ["0912345678", "+84912345678", "84912345678", "+84 912-345-678"]) {
      expect((await login(phone, PW)).body).toEqual({ next: "done" });
    }
  });

  it("số đã có (dạng khác) → phone_taken; số đã xác minh của người khác → phone_taken", async () => {
    await register("0912345678");
    expect(await register("+84912345678")).toMatchObject({ status: 409, body: { error: "phone_taken" } });
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84987654321", displayName: "Người có Zalo", rank: null }));
    expect(await register("0987654321")).toMatchObject({ status: 409, body: { error: "phone_taken" } });
    expect(await prisma().passwordLogin.count()).toBe(1);
  });

  it("số sai dạng → 400 invalid_phone; mật khẩu yếu → 400 weak_password kèm lý do", async () => {
    expect(await register("12345")).toMatchObject({ status: 400, body: { error: "invalid_phone" } });
    expect(await register("0912345678", { password: "1234567" })).toMatchObject({ status: 400, body: { error: "weak_password", problem: "too_short" } });
    expect(await register("0912345678", { password: "0912345678" })).toMatchObject({ status: 400, body: { error: "weak_password", problem: "phone" } });
    expect(await prisma().user.count()).toBe(0);
  });

  it("mỗi IP tối đa 5 lần đăng ký mỗi giờ, tính cả lần hỏng (số đã có): giữ chỗ trước khi băm", async () => {
    await register("0912345600");
    const ip = freshIp();
    for (let i = 0; i < 3; i++) expect((await register("0912345600", { ip })).body).toEqual({ error: "phone_taken" });
    for (let i = 1; i <= 2; i++) expect((await register(`091234560${i}`, { ip })).body).toEqual({ next: "done" });
    expect(await register("0912345609", { ip })).toMatchObject({ status: 429, body: { error: "throttled" } });
    expect((await register("0912345609")).body).toEqual({ next: "done" });
  });

  it("10 đăng ký song song từ một IP: đúng 5 được xử lý, 5 bị chặn", async () => {
    const ip = freshIp();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => register(`09500000${String(i).padStart(2, "0")}`, { ip })));
    expect(results.filter((r) => r.status === 429)).toHaveLength(5);
    expect(await prisma().passwordLogin.count()).toBe(5);
  });

  it("hai đăng ký cùng số chạy song song → một thắng, một phone_taken", async () => {
    const results = await Promise.all([register("0912345678"), register("+84912345678")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma().passwordLogin.count()).toBe(1);
  });
});

describe("đăng nhập bằng số + mật khẩu", () => {
  it("sai mật khẩu hay số không có tài khoản → cùng một câu trả lời invalid, không phiên", async () => {
    await register("0912345678");
    expect(await login("0912345678", "sai mat khau")).toEqual({ status: 200, body: { next: "invalid" }, session: undefined });
    expect(await login("0911111111", PW)).toEqual({ status: 200, body: { next: "invalid" }, session: undefined });
    expect(await login("abc", PW)).toEqual({ status: 200, body: { next: "invalid" }, session: undefined });
  });

  it("5 lần sai → khóa 15 phút (cả mật khẩu đúng); số không có tài khoản bị khóa y hệt; hết 15 phút thì vào được", async () => {
    await register("0912345678");
    const run = async (phone: string) => {
      const out: unknown[] = [];
      for (let i = 0; i < 5; i++) out.push((await login(phone, `sai ${i} lan nua`)).body.next);
      out.push((await login(phone, PW)).body.next);
      return out;
    };
    const expected = ["invalid", "invalid", "invalid", "invalid", "invalid", "locked"];
    expect(await run("0912345678")).toEqual(expected);
    expect(await run("0911111111")).toEqual(expected);
    await ageAttempts(15 * 60_000 + 1_000);
    expect((await login("0912345678", PW)).body).toEqual({ next: "done" });
  });

  it("lần đúng xóa đếm sai trước đó", async () => {
    await register("0912345678");
    for (let i = 0; i < 4; i++) await login("0912345678", "sai roi nhe");
    expect((await login("0912345678", PW)).body).toEqual({ next: "done" });
    for (let i = 0; i < 4; i++) await login("0912345678", "sai roi nhe");
    expect((await login("0912345678", PW)).body).toEqual({ next: "done" });
  });

  it("một IP sai 20 lần (nhiều số) → IP đó bị khóa kể cả đúng mật khẩu; IP khác vẫn vào được", async () => {
    await register("0912345678");
    const ip = freshIp();
    for (let i = 0; i < 20; i++) await login(`09300000${String(i).padStart(2, "0")}`, "sai", { ip });
    expect((await login("0912345678", PW, { ip })).body).toEqual({ next: "locked" });
    expect((await login("0912345678", PW)).body).toEqual({ next: "done" });
  });

  it("25 lần sai song song từ một IP: không quá 20 lần được kiểm, phần còn lại locked", async () => {
    const ip = freshIp();
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => login(`09400000${String(i).padStart(2, "0")}`, "sai", { ip })));
    expect(results.filter((r) => r.body.next === "locked")).toHaveLength(5);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_attempts WHERE ip = $1::inet AND NOT ok`, [ip]);
    expect(rows[0].n).toBe(20);
  });

  it("giới hạn 2 máy vẫn áp: máy thứ 3 phải chọn máy để thay", async () => {
    await register("0912345678", { deviceKey: newDeviceKey() });
    expect((await login("0912345678", PW, { deviceKey: newDeviceKey() })).body).toEqual({ next: "done" });
    const third = await login("0912345678", PW, { deviceKey: newDeviceKey() });
    expect(third.body.next).toBe("choose_device");
    expect(third.session).toBeUndefined();
  });

  it("tài khoản bị khóa → invalid", async () => {
    await register("0912345678");
    await sqlAsMigrator(`UPDATE users SET status = 'disabled'`);
    expect((await login("0912345678", PW)).body).toEqual({ next: "invalid" });
  });

  it("mật khẩu tạm (must_change): chưa kèm mật khẩu mới → set_password, không phiên; kèm mật khẩu mới hợp lệ → đổi và vào", async () => {
    await register("0912345678");
    await sqlAsMigrator(`UPDATE password_logins SET must_change = true`);
    expect(await login("0912345678", PW)).toEqual({ status: 200, body: { next: "set_password" }, session: undefined });
    expect((await login("0912345678", PW, { newPassword: "1234" })).body).toEqual({ next: "weak_password", problem: "too_short" });
    const done = await login("0912345678", PW, { newPassword: "Mat khau moi 2026" });
    expect(done.body).toEqual({ next: "done" });
    expect(done.session).toBeTruthy();
    expect((await prisma().passwordLogin.findFirstOrThrow()).mustChange).toBe(false);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_attempts WHERE kind = 'login' AND NOT ok`);
    expect(rows[0].n).toBe(0);
    expect((await login("0912345678", PW)).body).toEqual({ next: "invalid" });
    expect((await login("0912345678", "Mat khau moi 2026")).body).toEqual({ next: "done" });
  });
});

describe("dọn lượt thử quá 30 ngày (G12a)", () => {
  it("job me.auth.prune-password-attempts chỉ xóa dòng quá 30 ngày", async () => {
    await sqlAsMigrator(`INSERT INTO password_attempts (kind, ip, phone_canonical, ok, at) VALUES
      ('login', '10.1.1.1', '+84912345678', false, now() - interval '31 days'),
      ('register', '10.1.1.1', '+84912345678', true, now() - interval '40 days'),
      ('login', '10.1.1.1', '+84912345678', false, now() - interval '29 days')`);
    const job = JOBS.find((j) => j.name === "me.auth.prune-password-attempts")!;
    expect(job.schedule).toEqual({ dailyAt: "04:10" });
    expect(await job.run({} as never)).toEqual({ deleted: 2, adminDeleted: 0, pendingCredentials: 0 });
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_attempts`);
    expect(rows[0].n).toBe(1);
  });
});

describe("quyền của app trên bảng lượt thử", () => {
  it("app không xóa được lịch sử lượt thử", async () => {
    await login("0912345678", "sai");
    await expect(prisma().$executeRaw`DELETE FROM password_attempts`).rejects.toThrow(/permission denied/);
  });
});

describe("số đã xác minh thắng số chưa xác minh", () => {
  it("học viên khác xác minh số → dòng chưa xác minh bị nhả, đăng nhập mật khẩu với số đó invalid; số được đăng ký lại không được", async () => {
    await register("0912345678");
    // Tạo danh tính số đã xác minh (đăng ký bằng mã Zalo sau G6) tự nhả dòng chưa xác minh của người khác.
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84912345678", displayName: "Chủ số thật", rank: null }));
    expect((await prisma().passwordLogin.findFirstOrThrow()).releasedAt).not.toBeNull();
    expect((await login("0912345678", PW)).body).toEqual({ next: "invalid" });
    expect((await register("0912345678")).body).toEqual({ error: "phone_taken" });
    const { rows } = await sqlAsMigrator(`SELECT admin_user_id, target_id, after FROM admin_audit_log WHERE action = 'password_login_released'`);
    const released = await prisma().passwordLogin.findFirstOrThrow();
    expect(rows).toEqual([{ admin_user_id: null, target_id: released.userId, after: { phone: "•••• 5678", reason: "verified_by_other" } }]);
  });

  it("chính học viên xác minh số của mình → ghi phone_verified_at, vẫn đăng nhập bằng mật khẩu được", async () => {
    await register("0912345678");
    const row = await prisma().passwordLogin.findFirstOrThrow();
    await withTx((tx) => claimVerifiedPhone(tx, row.userId, "+84912345678"));
    expect(await prisma().passwordLogin.findFirstOrThrow()).toMatchObject({ releasedAt: null, phoneVerifiedAt: expect.any(Date) });
    expect((await login("0912345678", PW)).body).toEqual({ next: "done" });
  });
});
