import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { withTx } from "@/lib/db";
import { consumeAdminLink, issueAdminLink } from "@/modules/auth-admin/email-link";
import { inviteAdmin } from "@/modules/auth-admin/admins";
import { devMailbox, FakeEmailSink } from "@/modules/mail/fake-sink";
import { validateSession } from "@/modules/sessions/sessions";
import { consumeOidcState } from "@/modules/auth-oidc/oidc-states";
import { POST as sendLinkRoute } from "@/app/api/auth/admin/link/send/route";
import { POST as consumeLinkRoute } from "@/app/api/auth/admin/link/consume/route";
import { POST as googleStart } from "@/app/api/auth/admin/google/start/route";
import { GET as googleCallback } from "@/app/api/auth/admin/google/callback/route";
import { adminRow, ageInvite, auditRows, insertAdmin, ownerCtx } from "../helpers/admin";
import { cookieValue, post } from "../helpers/learner";
import { FakeGoogle } from "../helpers/google";
import { findInDb } from "../helpers/scan";
import { sqlAsMigrator } from "../helpers/otp";

const MIN = 60_000;
const DAY = 86_400_000;
const MARGIN = 1_000;
const fake = new FakeGoogle();
let logged: string[] = [];

beforeAll(async () => {
  process.env.GOOGLE_ISSUER = await fake.start();
});
afterAll(() => fake.stop());
beforeEach(() => {
  fake.reset();
  devMailbox.clear();
  logged = [];
  for (const m of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  }
});
afterEach(() => vi.restoreAllMocks());

async function linkFor(email: string): Promise<string> {
  const sink = new FakeEmailSink();
  await issueAdminLink(email, sink);
  const url = sink.messages().at(-1)?.body;
  if (!url) throw new Error("không có link");
  const parsed = new URL(url);
  if (parsed.searchParams.has("link")) throw new Error("token không được nằm trong query");
  return new URLSearchParams(parsed.hash.slice(1)).get("link")!;
}

async function ageLinks(ms: number) {
  await sqlAsMigrator(
    `UPDATE admin_email_links SET created_at = created_at - make_interval(secs => $1::double precision / 1000),
       expires_at = expires_at - make_interval(secs => $1::double precision / 1000)`,
    [ms],
  );
}

describe("link email quản trị", () => {
  it("admin active: link → phiên; DB và log không chứa token thô; audit ok", async () => {
    const id = await insertAdmin("chu@x.vn");
    const token = await linkFor("Chu@X.vn");
    const s = await consumeAdminLink(token);
    expect(s).not.toBeNull();
    expect((await validateSession("admin", s!.token))!.subjectId).toBe(id);
    expect(await findInDb(token)).toEqual([]);
    expect(await findInDb(s!.token)).toEqual([]);
    expect(logged.join("\n")).not.toContain(token);
    expect(await auditRows("admin_login")).toMatchObject([{ admin_user_id: id, result: "ok" }]);
  });

  it("biên 15 phút; dùng lại → null + audit denied", async () => {
    await insertAdmin("chu@x.vn");
    const a = await linkFor("chu@x.vn");
    await ageLinks(15 * MIN - MARGIN);
    expect(await consumeAdminLink(a)).not.toBeNull();
    expect(await consumeAdminLink(a)).toBeNull();
    const b = await linkFor("chu@x.vn");
    await sqlAsMigrator(`UPDATE admin_email_links SET created_at = created_at - interval '15 minutes', expires_at = expires_at - interval '15 minutes' WHERE used_at IS NULL`);
    expect(await consumeAdminLink(b)).toBeNull();
    expect((await auditRows("admin_login")).map((r) => r.result)).toEqual(["ok", "denied", "denied"]);
  });

  it("giới hạn gửi link: chờ 60 giây, tối đa 10 link/24 giờ; link mới hủy link cũ chưa dùng", async () => {
    await insertAdmin("chu@x.vn");
    const sink = new FakeEmailSink();
    await issueAdminLink("chu@x.vn", sink);
    await issueAdminLink("chu@x.vn", sink);
    expect(sink.messages()).toHaveLength(1);
    const first = new URLSearchParams(new URL(sink.messages()[0]!.body).hash.slice(1)).get("link")!;
    await ageLinks(60_000);
    await issueAdminLink("chu@x.vn", sink);
    expect(sink.messages()).toHaveLength(2);
    expect(await consumeAdminLink(first)).toBeNull();
    for (let i = 0; i < 8; i++) {
      await ageLinks(60_000);
      await issueAdminLink("chu@x.vn", sink);
    }
    expect(sink.messages()).toHaveLength(10);
    await ageLinks(60_000);
    await issueAdminLink("chu@x.vn", sink);
    expect(sink.messages()).toHaveLength(10);
  });

  it("hai lần dùng song song → đúng một phiên", async () => {
    await insertAdmin("chu@x.vn");
    const token = await linkFor("chu@x.vn");
    const results = await Promise.all([consumeAdminLink(token), consumeAdminLink(token)]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it("admin revoked với link còn hạn → null", async () => {
    await insertAdmin("chu@x.vn");
    const id = await insertAdmin("b@x.vn", "support");
    const token = await linkFor("b@x.vn");
    await sqlAsMigrator(`UPDATE admin_users SET status = 'revoked' WHERE id = $1`, [id]);
    expect(await consumeAdminLink(token)).toBeNull();
  });

  it("lời mời: link kích hoạt được trước hạn mời, đúng hạn mời → null", async () => {
    const ctx = await ownerCtx();
    await inviteAdmin(ctx, { email: "moi@x.vn", role: "support" });
    const ok = await linkFor("moi@x.vn");
    await ageInvite("moi@x.vn", 7 * DAY - MARGIN);
    expect(await consumeAdminLink(ok)).not.toBeNull();
    expect((await adminRow("moi@x.vn"))!.status).toBe("active");

    await inviteAdmin(ctx, { email: "tre@x.vn", role: "support" });
    const late = await linkFor("tre@x.vn");
    await ageInvite("tre@x.vn", 7 * DAY);
    expect(await consumeAdminLink(late)).toBeNull();
    expect((await adminRow("tre@x.vn"))!.status).toBe("invited");
  });

  it("route gửi link: email không có thật → không thư, phản hồi giống hệt email có thật", async () => {
    await insertAdmin("chu@x.vn");
    const real = await sendLinkRoute(post("/api/auth/admin/link/send", { email: "chu@x.vn" }));
    const fakeEmail = await sendLinkRoute(post("/api/auth/admin/link/send", { email: "khong@x.vn" }));
    const malformed = await sendLinkRoute(post("/api/auth/admin/link/send", { email: "rac" }));
    for (const res of [real, fakeEmail, malformed]) expect([res.status, await res.json()]).toEqual([200, { ok: true }]);
    expect(devMailbox.messages().map((m) => m.to)).toEqual(["chu@x.vn"]);
  });

  it("route dùng link: thành công đặt cookie quản trị; link hỏng → invalid", async () => {
    await insertAdmin("chu@x.vn");
    const token = await linkFor("chu@x.vn");
    const res = await consumeLinkRoute(post("/api/auth/admin/link/consume", { token }));
    expect(await res.json()).toEqual({ next: "done" });
    expect(cookieValue(res, "__Host-me_admin")).toBeTruthy();
    expect(cookieValue(res, "__Host-me_csrf_admin")).toBeTruthy();
    const bad = await consumeLinkRoute(post("/api/auth/admin/link/consume", { token }));
    expect(await bad.json()).toEqual({ next: "invalid" });
  });
});

describe("Google quản trị", () => {
  async function login(claims: { sub: string; email?: string; email_verified?: boolean }) {
    const res = await googleStart(post("/api/auth/admin/google/start", {}));
    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    const stateCookie = cookieValue(res, "__Host-me_oidc_admin")!;
    fake.nextToken(claims);
    const back = (await fetch(redirectUrl, { redirect: "manual" })).headers.get("location")!;
    return googleCallback(new Request(back, { headers: { cookie: `__Host-me_oidc_admin=${stateCookie}` } }));
  }
  const where = (res: Response) => new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;
  const adminToken = (res: Response) => cookieValue(res, "__Host-me_admin");

  it("sub mới + email khớp admin invited → kích hoạt + phiên; lần sau đăng nhập theo sub", async () => {
    const ctx = await ownerCtx();
    await inviteAdmin(ctx, { email: "moi@x.vn", role: "support" });
    const res = await login({ sub: "g-moi", email: "Moi@X.vn", email_verified: true });
    expect(where(res)).toBe("/quan-tri");
    expect(await validateSession("admin", adminToken(res)!)).not.toBeNull();
    expect((await adminRow("moi@x.vn"))!.status).toBe("active");
    const again = await login({ sub: "g-moi", email: "doi-email@gmail.com", email_verified: true });
    expect(adminToken(again)).toBeTruthy();
  });

  it("email_verified=false, email không trong danh sách, admin đã gắn sub khác → từ chối", async () => {
    const id = await insertAdmin("chu@x.vn");
    await sqlAsMigrator(`INSERT INTO admin_identities (admin_user_id, google_sub) VALUES ($1, 'g-cu')`, [id]);
    for (const claims of [
      { sub: "g1", email: "chu@x.vn", email_verified: false },
      { sub: "g2", email: "la@x.vn", email_verified: true },
      { sub: "g3", email: "chu@x.vn", email_verified: true },
    ]) {
      const res = await login(claims);
      expect(adminToken(res), JSON.stringify(claims)).toBeUndefined();
      expect(where(res)).toBe("/quan-tri/dang-nhap?loi=google");
    }
  });

  it("sub đã gắn admin bị thu hồi → từ chối", async () => {
    await insertAdmin("chu@x.vn");
    const id = await insertAdmin("b@x.vn", "support", "revoked");
    await sqlAsMigrator(`INSERT INTO admin_identities (admin_user_id, google_sub) VALUES ($1, 'g-b')`, [id]);
    expect(adminToken(await login({ sub: "g-b", email: "b@x.vn", email_verified: true }))).toBeUndefined();
  });

  it("hai callback kích hoạt song song cùng admin → một admin_identities, admin active", async () => {
    const ctx = await ownerCtx();
    await inviteAdmin(ctx, { email: "moi@x.vn", role: "support" });
    const results = await Promise.all([
      login({ sub: "g-x", email: "moi@x.vn", email_verified: true }),
      login({ sub: "g-x", email: "moi@x.vn", email_verified: true }),
    ]);
    expect(results.some((r) => adminToken(r))).toBe(true);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_identities`);
    expect(rows[0].n).toBe(1);
    expect((await adminRow("moi@x.vn"))!.status).toBe("active");
  });

  it("cookie state quản trị không dùng được ở khu vực học viên; cookie state bị xóa sau callback", async () => {
    await insertAdmin("chu@x.vn");
    const res = await googleStart(post("/api/auth/admin/google/start", {}));
    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    const stateCookie = cookieValue(res, "__Host-me_oidc_admin")!;
    const state = new URL(redirectUrl).searchParams.get("state")!;
    expect(await withTx((tx) => consumeOidcState(tx, "learner", stateCookie, state))).toBeNull();
    const out = await login({ sub: "g-chu", email: "chu@x.vn", email_verified: true });
    expect(out.headers.getSetCookie().find((c) => c.startsWith("__Host-me_oidc_admin="))).toContain("Max-Age=0");
  });
});
