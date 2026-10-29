import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { completeLinkGoogle, completeLinkOtp, startLink, unlinkIdentity } from "@/modules/auth-learner/link";
import type { LearnerCtx } from "@/modules/sessions/guards";
import { createSession } from "@/modules/sessions/sessions";
import { devMailbox } from "@/modules/mail/fake-sink";
import { GET as googleCallback } from "@/app/api/auth/learner/google/callback/route";
import { GET as listIdentities, DELETE as deleteIdentity } from "@/app/api/me/identities/route";
import { authorize, FakeGoogle } from "../helpers/google";
import { lastCode, newDeviceKey } from "../helpers/learner";
import { ageSendLog } from "../helpers/otp";

const MIN = 60_000;
const MARGIN = 1_000;
const ORIGIN = process.env.APP_ORIGIN!;
const fake = new FakeGoogle();

beforeAll(async () => {
  process.env.GOOGLE_ISSUER = await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => {
  fake.reset();
  devMailbox.clear();
});

type Learner = LearnerCtx & { token: string };

async function learner(email: string, authAt = new Date()): Promise<Learner> {
  const user = await prisma().user.create({ data: { displayName: email } });
  await prisma().userIdentity.create({ data: { userId: user.id, kind: "email", valueCanonical: email, verifiedAt: new Date() } });
  const device = await prisma().device.create({ data: { userId: user.id, deviceKeyHash: newDeviceKey(), label: "đt" } });
  const s = await withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt }));
  return { userId: user.id, deviceId: device.id, sessionId: s.sessionId, authAt, ip: "10.0.0.1", token: s.token };
}

async function sendLinkCode(ctx: LearnerCtx, email: string): Promise<string> {
  await ageSendLog(61_000);
  expect(await startLink(ctx, { kind: "email", contact: email })).toEqual({ status: "sent" });
  return lastCode(email);
}

const identities = (userId: string) => prisma().userIdentity.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe("liên kết bằng mã OTP", () => {
  it("xác thực gần đây: 10 phút − 1 giây được; đúng 10 phút → reauth_required", async () => {
    const ok = await learner("a@x.vn", new Date(Date.now() - 10 * MIN + MARGIN));
    const code = await sendLinkCode(ok, "a2@x.vn");
    expect(await completeLinkOtp(ok, { kind: "email", contact: "a2@x.vn", code })).toBe("linked");
    expect((await identities(ok.userId)).map((i) => i.valueCanonical)).toEqual(["a@x.vn", "a2@x.vn"]);

    const stale = await learner("b@x.vn", new Date(Date.now() - 10 * MIN));
    expect(await startLink(stale, { kind: "email", contact: "b2@x.vn" })).toEqual({ status: "reauth_required" });
    expect(await completeLinkOtp(stale, { kind: "email", contact: "b2@x.vn", code: "123456" })).toBe("reauth_required");
  });

  it("mã link của A dùng với phiên B → invalid", async () => {
    const a = await learner("a@x.vn");
    const b = await learner("b@x.vn");
    const code = await sendLinkCode(a, "moi@x.vn");
    expect(await completeLinkOtp(b, { kind: "email", contact: "moi@x.vn", code })).toBe("invalid");
    expect(await completeLinkOtp(a, { kind: "email", contact: "moi@x.vn", code })).toBe("linked");
  });

  it("email đã thuộc người khác → owned_by_other, không đổi gì; dùng lại mã → invalid", async () => {
    const a = await learner("a@x.vn");
    await learner("b@x.vn");
    const code = await sendLinkCode(a, "b@x.vn");
    expect(await completeLinkOtp(a, { kind: "email", contact: "b@x.vn", code })).toBe("owned_by_other");
    expect((await identities(a.userId)).map((i) => i.valueCanonical)).toEqual(["a@x.vn"]);
    expect(await completeLinkOtp(a, { kind: "email", contact: "b@x.vn", code })).toBe("invalid");
  });

  it("dùng lại mã sau khi đã liên kết → invalid", async () => {
    const a = await learner("a@x.vn");
    const code = await sendLinkCode(a, "a2@x.vn");
    expect(await completeLinkOtp(a, { kind: "email", contact: "a2@x.vn", code })).toBe("linked");
    expect(await completeLinkOtp(a, { kind: "email", contact: "a2@x.vn", code })).toBe("invalid");
  });
});

describe("liên kết Google", () => {
  async function linkViaCallback(ctx: Learner, sub: string, sessionToken = ctx.token) {
    const started = await startLink(ctx, { kind: "google" });
    if (started.status !== "redirect") throw new Error(started.status);
    fake.nextToken({ sub, email: `${sub}@gmail.com`, email_verified: true });
    const url = await authorize({ redirectUrl: started.redirectUrl, stateCookie: started.stateCookie, deviceKey: "" });
    const run = () =>
      googleCallback(new Request(url, { headers: { cookie: `__Host-me_learn=${sessionToken}; __Host-me_oidc_learner=${started.stateCookie}` } }));
    return { first: await run(), replay: run };
  }

  const where = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;

  it("sub mới → linked; replay callback không gắn lần hai", async () => {
    const a = await learner("a@x.vn");
    const { first, replay } = await linkViaCallback(a, "ga");
    expect(where(first)).toBe("/tai-khoan?lien-ket=linked");
    expect((await identities(a.userId)).map((i) => i.kind)).toEqual(["email", "google"]);
    expect(where(await replay())).toBe("/dang-nhap?loi=google");
    expect(await prisma().userIdentity.count({ where: { kind: "google" } })).toBe(1);
  });

  it("sub đã thuộc người khác → owned_by_other", async () => {
    const b = await learner("b@x.vn");
    await prisma().userIdentity.create({ data: { userId: b.userId, kind: "google", valueCanonical: "gb", verifiedAt: new Date() } });
    const a = await learner("a@x.vn");
    const { first } = await linkViaCallback(a, "gb");
    expect(where(first)).toBe("/tai-khoan?lien-ket=owned_by_other");
    expect((await identities(a.userId)).map((i) => i.kind)).toEqual(["email"]);
  });

  it("state link của A dùng với phiên B → invalid", async () => {
    const a = await learner("a@x.vn");
    const b = await learner("b@x.vn");
    const { first } = await linkViaCallback(a, "gx", b.token);
    expect(where(first)).toBe("/tai-khoan?lien-ket=invalid");
    expect(await prisma().userIdentity.count({ where: { kind: "google" } })).toBe(0);
  });

  it("completeLinkGoogle từ chối state của người khác", async () => {
    const a = await learner("a@x.vn");
    const b = await learner("b@x.vn");
    const st = {
      id: crypto.randomUUID(), realm: "learner" as const, intent: "link" as const, userId: a.userId, nonce: "n",
      codeVerifier: "v", deviceKeyHash: null, deviceLabel: null, createdAt: new Date(),
    };
    expect(await completeLinkGoogle(b, st, { sub: "gy", email: null, emailVerified: false })).toBe("invalid");
    expect(await completeLinkGoogle(a, st, { sub: "gy", email: null, emailVerified: false })).toBe("linked");
  });
});

describe("gỡ định danh", () => {
  async function withTwo() {
    const a = await learner("a@x.vn");
    const code = await sendLinkCode(a, "a2@x.vn");
    await completeLinkOtp(a, { kind: "email", contact: "a2@x.vn", code });
    return { a, ids: (await identities(a.userId)).map((i) => i.id) };
  }

  it("còn 2 → unlinked; cái cuối → last_identity; của người khác → not_found; lâu chưa xác thực → reauth_required", async () => {
    const { a, ids } = await withTwo();
    const other = await learner("c@x.vn");
    const otherId = (await identities(other.userId))[0]!.id;
    expect(await unlinkIdentity(a, otherId)).toBe("not_found");
    expect(await unlinkIdentity({ ...a, authAt: new Date(Date.now() - 10 * MIN) }, ids[1]!)).toBe("reauth_required");
    expect(await unlinkIdentity(a, ids[1]!)).toBe("unlinked");
    expect(await unlinkIdentity(a, ids[0]!)).toBe("last_identity");
  });

  it("hai lệnh gỡ song song khi còn 2 → đúng một unlinked", async () => {
    const { a, ids } = await withTwo();
    const results = await Promise.all(ids.map((id) => unlinkIdentity(a, id)));
    expect(results.sort()).toEqual(["last_identity", "unlinked"]);
    expect(await prisma().userIdentity.count({ where: { userId: a.userId } })).toBe(1);
  });

  it("route: GET liệt kê, DELETE cần CSRF và trả mã trạng thái theo kết quả", async () => {
    const { a, ids } = await withTwo();
    const csrf = (await import("@/modules/sessions/csrf")).csrfFor("learner", a.sessionId);
    const cookie = `__Host-me_learn=${a.token}`;
    const list = await listIdentities(new Request(`${ORIGIN}/api/me/identities`, { headers: { cookie } }));
    expect(((await list.json()) as { identities: unknown[] }).identities).toHaveLength(2);
    const del = (id: string, headers: Record<string, string>) =>
      deleteIdentity(new Request(`${ORIGIN}/api/me/identities?id=${id}`, { method: "DELETE", headers: { cookie, ...headers } }));
    expect((await del(ids[1]!, { origin: ORIGIN })).status).toBe(403);
    expect((await del(ids[1]!, { origin: ORIGIN, "x-csrf-token": csrf })).status).toBe(200);
    const last = await del(ids[0]!, { origin: ORIGIN, "x-csrf-token": csrf });
    expect([last.status, await last.json()]).toEqual([409, { result: "last_identity" }]);
  });
});
