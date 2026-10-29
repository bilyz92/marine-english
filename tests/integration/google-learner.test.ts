import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { consumeOidcState } from "@/modules/auth-oidc/oidc-states";
import { validateSession } from "@/modules/sessions/sessions";
import { cookieValue, newDeviceKey, post } from "../helpers/learner";
import { authorize, callback, FakeGoogle, googleLogin, startGoogle } from "../helpers/google";
import { sqlAsMigrator } from "../helpers/otp";
import { POST as startRoute } from "@/app/api/auth/learner/google/start/route";
import { GET as listTicketDevices } from "@/app/api/auth/learner/device/select/route";

const fake = new FakeGoogle();
const MIN = 60_000;
const MARGIN = 1_000;

beforeAll(async () => {
  // env() chưa được đọc trong tệp này nên đặt issuer giả trước lần đọc đầu.
  process.env.GOOGLE_ISSUER = await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => fake.reset());

const session = (res: Response) => cookieValue(res, "__Host-me_learn");
const location = (res: Response) => new URL(res.headers.get("location")!, process.env.APP_ORIGIN).pathname + new URL(res.headers.get("location")!, process.env.APP_ORIGIN).search;
const verified = (sub: string, email = `${sub}@gmail.com`) => ({ sub, email, email_verified: true });

describe("Google OIDC học viên", () => {
  it("luồng đúng → phiên; tạo user + identity google + email; cookie state bị xóa", async () => {
    const res = await googleLogin(verified("g1", "Thuy.Thu@Gmail.com"), fake);
    expect(res.status).toBe(303);
    expect(location(res)).toBe("/hoc");
    expect(await validateSession("learner", session(res)!)).not.toBeNull();
    const state = res.headers.getSetCookie().find((c) => c.startsWith("__Host-me_oidc_learner="))!;
    expect(state).toContain("Max-Age=0");
    const user = await prisma().user.findFirstOrThrow({ include: { identities: true } });
    expect(user.displayName).toBe("thuy.thu");
    expect(user.rank).toBeNull();
    expect(user.identities.map((i) => [i.kind, i.valueCanonical]).sort()).toEqual([
      ["email", "thuy.thu@gmail.com"],
      ["google", "g1"],
    ]);
    const again = await googleLogin(verified("g1"), fake);
    expect(session(again)).toBeTruthy();
    expect(await prisma().user.count()).toBe(1);
  });

  it("start: khóa thiết bị sai định dạng → 400", async () => {
    const res = await startRoute(post("/api/auth/learner/google/start", { deviceKey: "ngan", deviceLabel: "x" }));
    expect(res.status).toBe(400);
  });

  it("state sai, thiếu cookie, replay → không phiên", async () => {
    const started = await startGoogle();
    fake.nextToken(verified("g2"));
    const url = new URL(await authorize(started));
    const forged = new URL(url);
    forged.searchParams.set("state", "khac");
    const bad = await callback(forged.toString(), started.stateCookie);
    expect(session(bad)).toBeUndefined();
    expect(location(bad)).toBe("/dang-nhap?loi=google");
    const noCookie = await callback(url.toString(), undefined);
    expect(session(noCookie)).toBeUndefined();

    const s2 = await startGoogle();
    fake.nextToken(verified("g2"));
    const ok = await authorize(s2);
    expect(session(await callback(ok, s2.stateCookie))).toBeTruthy();
    expect(session(await callback(ok, s2.stateCookie))).toBeUndefined();
  });

  it("hai callback song song cùng state → một phiên", async () => {
    const started = await startGoogle();
    fake.nextToken(verified("g3"));
    fake.nextToken(verified("g3"));
    const url = await authorize(started);
    const results = await Promise.all([callback(url, started.stateCookie), callback(url, started.stateCookie)]);
    expect(results.filter((r) => session(r)).length).toBe(1);
  });

  it("biên 10 phút của state", async () => {
    const a = await startGoogle();
    await sqlAsMigrator(
      `UPDATE oidc_states SET created_at = created_at - make_interval(secs => $1::double precision / 1000),
         expires_at = expires_at - make_interval(secs => $1::double precision / 1000)`,
      [10 * MIN - MARGIN],
    );
    fake.nextToken(verified("g4"));
    expect(session(await callback(await authorize(a), a.stateCookie))).toBeTruthy();

    const b = await startGoogle();
    await sqlAsMigrator(
      `UPDATE oidc_states SET created_at = created_at - interval '10 minutes', expires_at = expires_at - interval '10 minutes'
       WHERE used_at IS NULL`,
    );
    fake.nextToken(verified("g4"));
    expect(session(await callback(await authorize(b), b.stateCookie))).toBeUndefined();
  });

  it("nonce sai, aud sai, iss lạ → không phiên; iss = accounts.google.com → được", async () => {
    for (const bad of [{ nonce: "khac" }, { aud: "client-khac" }, { iss: "https://evil.example" }]) {
      const res = await googleLogin({ ...verified("g5"), ...bad }, fake);
      expect(session(res), JSON.stringify(bad)).toBeUndefined();
    }
    expect(await prisma().user.count()).toBe(0);
    const res = await googleLogin({ ...verified("g5"), iss: "accounts.google.com" }, fake);
    expect(session(res)).toBeTruthy();
    const res2 = await googleLogin({ ...verified("g6"), iss: "https://accounts.google.com" }, fake);
    expect(session(res2)).toBeTruthy();
  });

  it("lần đầu email_verified=false → không tạo gì", async () => {
    const res = await googleLogin({ sub: "g7", email: "a@gmail.com", email_verified: false }, fake);
    expect(location(res)).toBe("/dang-nhap?loi=google");
    expect(await prisma().user.count()).toBe(0);
    expect(await prisma().userIdentity.count()).toBe(0);
    expect(await prisma().device.count()).toBe(0);
    expect(await prisma().learnerSession.count()).toBe(0);
  });

  it("email đã thuộc tài khoản khác → user mới chỉ có identity google", async () => {
    const owner = await prisma().user.create({ data: { displayName: "Chủ email" } });
    await prisma().userIdentity.create({ data: { userId: owner.id, kind: "email", valueCanonical: "chung@gmail.com", verifiedAt: new Date() } });
    const res = await googleLogin(verified("g8", "chung@gmail.com"), fake);
    const view = await validateSession("learner", session(res)!);
    expect(view!.subjectId).not.toBe(owner.id);
    const identities = await prisma().userIdentity.findMany({ where: { userId: view!.subjectId } });
    expect(identities.map((i) => i.kind)).toEqual(["google"]);
  });

  it("máy thứ ba qua Google → choose_device + cookie vé", async () => {
    await googleLogin(verified("g9"), fake);
    await googleLogin(verified("g9"), fake);
    const res = await googleLogin(verified("g9"), fake);
    expect(location(res)).toBe("/dang-nhap/chon-thiet-bi");
    expect(session(res)).toBeUndefined();
    const ticket = cookieValue(res, "__Host-me_ticket")!;
    expect(ticket).toBeTruthy();
    const list = await listTicketDevices(new Request(`${process.env.APP_ORIGIN}/api/auth/learner/device/select`, { headers: { cookie: `__Host-me_ticket=${ticket}` } }));
    expect(((await list.json()) as { devices: unknown[] }).devices).toHaveLength(2);
    const none = await listTicketDevices(new Request(`${process.env.APP_ORIGIN}/api/auth/learner/device/select`));
    expect(await none.json()).toEqual({ devices: [] });
  });

  it("hai callback khác state cùng một sub mới, song song → một user, cả hai có phiên", async () => {
    const [a, b] = [await startGoogle(), await startGoogle()];
    fake.nextToken(verified("g10"));
    const ua = await authorize(a);
    fake.nextToken(verified("g10"));
    const ub = await authorize(b);
    const results = await Promise.all([callback(ua, a.stateCookie), callback(ub, b.stateCookie)]);
    expect(results.every((r) => session(r))).toBe(true);
    expect(await prisma().user.count()).toBe(1);
  });

  it("hai sub mới khác nhau cùng một email, song song → hai user, chỉ một có identity email", async () => {
    const [a, b] = [await startGoogle(), await startGoogle()];
    fake.nextToken(verified("g11", "trung@gmail.com"));
    const ua = await authorize(a);
    fake.nextToken(verified("g12", "trung@gmail.com"));
    const ub = await authorize(b);
    const results = await Promise.all([callback(ua, a.stateCookie), callback(ub, b.stateCookie)]);
    expect(results.every((r) => session(r))).toBe(true);
    expect(await prisma().user.count()).toBe(2);
    expect(await prisma().userIdentity.count({ where: { kind: "email" } })).toBe(1);
  });

  it("user disabled đăng nhập qua Google → không phiên", async () => {
    await googleLogin(verified("g13"), fake, newDeviceKey());
    await prisma().user.updateMany({ data: { status: "disabled" } });
    const res = await googleLogin(verified("g13"), fake);
    expect(session(res)).toBeUndefined();
    expect(location(res)).toBe("/dang-nhap?loi=google");
  });

  it("cookie state học viên đưa vào khu vực quản trị → từ chối", async () => {
    const started = await startGoogle();
    const state = new URL(started.redirectUrl).searchParams.get("state")!;
    expect(await withTx((tx) => consumeOidcState(tx, "admin", started.stateCookie, state))).toBeNull();
    expect(await withTx((tx) => consumeOidcState(tx, "learner", started.stateCookie, state))).not.toBeNull();
  });
});
