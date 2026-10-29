import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { createSession, validateSession } from "@/modules/sessions/sessions";
import { POST as learnerLogout } from "@/app/api/auth/learner/logout/route";
import { POST as adminLogout } from "@/app/api/auth/admin/logout/route";
import { pgAs } from "../helpers/pg";

const ORIGIN = process.env.APP_ORIGIN!;

async function bothSessions() {
  const user = await prisma().user.create({ data: { displayName: "HV" } });
  const device = await prisma().device.create({ data: { userId: user.id, deviceKeyHash: "k", label: "đt" } });
  const learner = await withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt: new Date() }));
  const client = await pgAs("migrator");
  const { rows } = await client.query(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at)
     VALUES ('chu@x.vn', 'owner', 'active', now(), now() + interval '7 days') RETURNING id`,
  );
  await client.end();
  const admin = await withTx((tx) => createSession(tx, { realm: "admin", adminId: rows[0].id, authAt: new Date() }));
  return { learner, admin, cookie: `__Host-me_learn=${learner.token}; __Host-me_admin=${admin.token}` };
}

function post(path: string, cookie: string, csrf: string) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { cookie, origin: ORIGIN, "x-csrf-token": csrf } });
}

function expectCleared(setCookies: string[], names: string[]) {
  for (const name of names) {
    const c = setCookies.find((s) => s.startsWith(`${name}=`));
    expect(c, name).toBeDefined();
    expect(c).toContain("Max-Age=0");
    expect(c).toContain("Path=/");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
  }
  expect(setCookies.find((s) => s.startsWith("__Host-me_learn=") || s.startsWith("__Host-me_admin="))).toContain("HttpOnly");
}

describe("đăng xuất theo khu vực", () => {
  it("đăng xuất học viên: phiên học viên thu hồi, phiên quản trị vẫn hợp lệ", async () => {
    const s = await bothSessions();
    const res = await learnerLogout(post("/api/auth/learner/logout", s.cookie, s.learner.csrf));
    expect(res.status).toBe(200);
    expectCleared(res.headers.getSetCookie(), ["__Host-me_learn", "__Host-me_csrf_learner"]);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("__Host-me_admin"))).toBe(false);
    expect(await validateSession("learner", s.learner.token)).toBeNull();
    expect(await validateSession("admin", s.admin.token)).not.toBeNull();
  });

  it("đăng xuất quản trị: phiên quản trị thu hồi, phiên học viên vẫn hợp lệ", async () => {
    const s = await bothSessions();
    const res = await adminLogout(post("/api/auth/admin/logout", s.cookie, s.admin.csrf));
    expect(res.status).toBe(200);
    expectCleared(res.headers.getSetCookie(), ["__Host-me_admin", "__Host-me_csrf_admin"]);
    expect(await validateSession("admin", s.admin.token)).toBeNull();
    expect(await validateSession("learner", s.learner.token)).not.toBeNull();
  });

  it("đăng xuất thiếu CSRF → 403, phiên còn nguyên", async () => {
    const s = await bothSessions();
    const res = await learnerLogout(new Request(`${ORIGIN}/api/auth/learner/logout`, { method: "POST", headers: { cookie: s.cookie, origin: ORIGIN } }));
    expect(res.status).toBe(403);
    expect(await validateSession("learner", s.learner.token)).not.toBeNull();
  });

  it("không có phiên → vẫn 200 và xóa cookie", async () => {
    const res = await learnerLogout(new Request(`${ORIGIN}/api/auth/learner/logout`, { method: "POST", headers: { origin: ORIGIN } }));
    expect(res.status).toBe(200);
    expectCleared(res.headers.getSetCookie(), ["__Host-me_learn", "__Host-me_csrf_learner"]);
  });
});
