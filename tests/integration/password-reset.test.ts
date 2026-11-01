import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { POST as registerRoute } from "@/app/api/auth/learner/password/register/route";
import { POST as sendRoute } from "@/app/api/auth/learner/password/reset/send/route";
import { POST as verifyRoute } from "@/app/api/auth/learner/password/reset/verify/route";
import { issueOtp } from "@/modules/auth-learner/otp";
import { devMailbox } from "@/modules/mail/fake-sink";
import { lastCode, newDeviceKey, ORIGIN } from "../helpers/learner";
import { ageSendLog, sqlAsMigrator } from "../helpers/otp";

// D2: quên mật khẩu → mã tới email đã liên kết (email xác minh mới nhất), đặt mật khẩu mới, thu hồi phiên, vé thay máy, mã cũ.

const PW = "Thuyenvien2026";
const NEW_PW = "Mat khau moi 2026";
const DEVICE = newDeviceKey();
let ipSeq = 0;
const ip = () => `10.8.0.${++ipSeq}`;

async function call(route: (r: Request) => Promise<Response>, path: string, body: unknown) {
  const res = await route(new Request(`${ORIGIN}${path}`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function account(phone: string, emails: { email: string; verifiedAt: string }[] = []) {
  await call(registerRoute, "/api/auth/learner/password/register", { phone, password: PW, displayName: "Học viên", deviceKey: DEVICE, deviceLabel: "Điện thoại" });
  const { userId } = await prisma().passwordLogin.findFirstOrThrow({ where: { phoneCanonical: `+84${phone.slice(1)}` } });
  for (const e of emails) {
    await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', $2, $3)`, [userId, e.email, e.verifiedAt]);
  }
  return userId;
}

const send = async (phone: string) => { await ageSendLog(61_000); return call(sendRoute, "/api/auth/learner/password/reset/send", { phone }); };
const reset = (phone: string, code: string, newPassword = NEW_PW, deviceKey = DEVICE) =>
  call(verifyRoute, "/api/auth/learner/password/reset/verify", { phone, code, newPassword, deviceKey, deviceLabel: "Điện thoại" });
const login = (phone: string, password: string) =>
  call(loginRoute, "/api/auth/learner/password/login", { phone, password, deviceKey: DEVICE, deviceLabel: "Điện thoại" });

describe("quên mật khẩu qua email đã liên kết", () => {
  it("mã tới email; đặt lại → vào được, mật khẩu cũ hết dùng, phiên cũ và vé thay máy cũ bị hủy", async () => {
    const userId = await account("0912345678", [{ email: "tho.may@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    // Máy thứ 2 rồi máy thứ 3 → có vé thay máy chưa dùng.
    await call(loginRoute, "/api/auth/learner/password/login", { phone: "0912345678", password: PW, deviceKey: newDeviceKey(), deviceLabel: "Máy 2" });
    expect((await call(loginRoute, "/api/auth/learner/password/login", { phone: "0912345678", password: PW, deviceKey: newDeviceKey(), deviceLabel: "Máy 3" })).body.next).toBe("choose_device");
    expect(await send("0912345678")).toEqual({ status: 200, body: { ok: true } });
    expect(await reset("0912345678", lastCode("tho.may@x.vn"))).toEqual({ status: 200, body: { next: "done" } });
    expect((await login("0912345678", PW)).body).toEqual({ next: "invalid" });
    expect((await login("0912345678", NEW_PW)).body).toEqual({ next: "done" });
    const { rows } = await sqlAsMigrator(
      `SELECT (SELECT count(*)::int FROM learner_sessions WHERE user_id = $1 AND revoked_at IS NULL) AS live,
              (SELECT count(*)::int FROM login_tickets WHERE user_id = $1 AND used_at IS NULL) AS tickets`, [userId]);
    expect(rows[0]).toEqual({ live: 2, tickets: 0 });
  });

  it("không có email liên kết hay số không có tài khoản → trả như nhau, không gửi thư; mã bất kỳ không dùng được", async () => {
    await account("0912345678");
    const before = devMailbox.messages().length;
    expect(await send("0912345678")).toEqual({ status: 200, body: { ok: true } });
    expect(await send("0911111111")).toEqual({ status: 200, body: { ok: true } });
    expect(await send("sai so")).toEqual({ status: 200, body: { ok: true } });
    expect(devMailbox.messages().length).toBe(before);
    expect((await reset("0912345678", "123456")).body).toEqual({ next: "invalid" });
  });

  it("mã sai → invalid; mã của học viên khác không dùng được cho số này", async () => {
    await account("0912345678", [{ email: "a@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    await account("0987654321", [{ email: "b@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    await send("0912345678");
    await send("0987654321");
    expect((await reset("0912345678", "000000")).body).toEqual({ next: "invalid" });
    expect((await reset("0912345678", lastCode("b@x.vn"))).body).toEqual({ next: "invalid" });
    expect((await reset("0912345678", lastCode("a@x.vn"))).body).toEqual({ next: "done" });
  });

  it("hai email: gửi tới email xác minh mới nhất; mã phát cho email kia không dùng được", async () => {
    const userId = await account("0912345678", [
      { email: "cu@x.vn", verifiedAt: "2026-09-01T00:00:00Z" },
      { email: "moi@x.vn", verifiedAt: "2026-10-15T00:00:00Z" },
    ]);
    await send("0912345678");
    expect(() => lastCode("cu@x.vn")).toThrow();
    let oldCode = "";
    await ageSendLog(61_000);
    await issueOtp({ purpose: "reset", kind: "email", value: "cu@x.vn", ip: "10.8.9.9", userId, create: true }, { send: async (_k, _v, c) => { oldCode = c; } });
    expect((await reset("0912345678", oldCode)).body).toEqual({ next: "invalid" });
    expect((await reset("0912345678", lastCode("moi@x.vn"))).body).toEqual({ next: "done" });
  });

  it("đặt lại lần nữa thì mã đặt lại cũ còn hạn bị hủy", async () => {
    await account("0912345678", [{ email: "a@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    await send("0912345678");
    const first = lastCode("a@x.vn");
    let second = "";
    await ageSendLog(61_000);
    const userId = (await prisma().passwordLogin.findFirstOrThrow()).userId;
    await issueOtp({ purpose: "reset", kind: "email", value: "a@x.vn", ip: "10.8.9.8", userId, create: true }, { send: async (_k, _v, c) => { second = c; } });
    expect((await reset("0912345678", second)).body).toEqual({ next: "done" });
    expect((await reset("0912345678", first, "Mat khau thu ba 2026")).body).toEqual({ next: "invalid" });
  });

  it("một IP thử mã đặt lại sai 20 lần (kể cả số không có tài khoản) → IP đó bị chặn, kể cả mã đúng; IP khác vẫn được", async () => {
    await account("0912345678", [{ email: "a@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    await send("0912345678");
    const code = lastCode("a@x.vn");
    const fixedIp = "10.8.200.1";
    const resetFrom = (ipAddr: string, phone: string, c: string) => verifyRoute(new Request(`${ORIGIN}/api/auth/learner/password/reset/verify`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ipAddr },
      body: JSON.stringify({ phone, code: c, newPassword: NEW_PW, deviceKey: DEVICE, deviceLabel: "Điện thoại" }),
    })).then(async (r) => ((await r.json()) as { next: string }).next);
    for (let i = 0; i < 20; i++) expect(await resetFrom(fixedIp, `09300000${String(i).padStart(2, "0")}`, "111111")).toBe("invalid");
    expect(await resetFrom(fixedIp, "0912345678", code)).toBe("locked");
    expect(await resetFrom("10.8.200.2", "0912345678", code)).toBe("done");
  });

  it("gửi mã cho số không có tài khoản cũng đi qua cùng bước kiểm hạn mức (ghi nhật ký gửi, không tạo mã)", async () => {
    await send("0911111111");
    const { rows } = await sqlAsMigrator(`SELECT kind, outcome FROM otp_send_log`);
    expect(rows).toEqual([{ kind: "email", outcome: "skipped" }]);
    const { rows: challenges } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM otp_challenges`);
    expect(challenges[0].n).toBe(0);
  });

  it("mật khẩu mới yếu → weak_password, mã vẫn còn để thử lại", async () => {
    await account("0912345678", [{ email: "a@x.vn", verifiedAt: "2026-10-01T00:00:00Z" }]);
    await send("0912345678");
    const code = lastCode("a@x.vn");
    expect((await reset("0912345678", code, "1234")).body).toEqual({ next: "weak_password", problem: "too_short" });
    expect((await reset("0912345678", code)).body).toEqual({ next: "done" });
  });
});
