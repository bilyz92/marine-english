import { describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/admin/password/login/route";
import { POST as setPassword } from "@/app/api/quan-tri/me/password/route";
import { GET as me } from "@/app/api/quan-tri/me/route";
import { JOBS } from "@/modules/jobs/definitions";
import { validateSession } from "@/modules/sessions/sessions";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { auditRows } from "../helpers/admin";
import { cookieValue, ORIGIN } from "../helpers/learner";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";
import { adminSession } from "../helpers/admin";

// D3 (docs/superpowers/plans/2026-11-02-admin-password.md): quản trị đăng nhập bằng email + mật khẩu.

const PW = "tau-dau-2026";

function tryLogin(email: string, password: string, ip = "10.9.0.1") {
  return login(new Request(`${ORIGIN}/api/auth/admin/password/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  }));
}

async function emailOf(s: AdminSess) {
  return (await sqlAsMigrator(`SELECT email_lower FROM admin_users WHERE id = $1`, [s.adminId])).rows[0].email_lower as string;
}

async function withPassword(role: "owner" | "support" = "owner") {
  const s = await adminSess(role);
  expect((await callAdmin(setPassword, s, "POST", "/api/quan-tri/me/password", { password: PW })).status).toBe(200);
  return { s, email: await emailOf(s) };
}

describe("quản trị đăng nhập bằng email + mật khẩu", () => {
  it("đặt mật khẩu rồi đăng nhập: tạo phiên quản trị, email không phân biệt hoa thường, có nhật ký; me báo hasPassword", async () => {
    const { s, email } = await withPassword();
    const res = await tryLogin(`  ${email.toUpperCase()} `, PW);
    expect(await res.json()).toEqual({ next: "done" });
    const token = cookieValue(res, "__Host-me_admin")!;
    expect((await validateSession("admin", token))?.subjectId).toBe(s.adminId);
    expect(cookieValue(res, "__Host-me_learn")).toBeUndefined();
    const logins = await auditRows("admin_login");
    expect(logins.at(-1)).toMatchObject({ admin_user_id: s.adminId, result: "ok", reason: "password" });
    expect(await (await callAdmin(me, s, "GET", "/api/quan-tri/me")).json()).toMatchObject({ hasPassword: true });
  });

  it("sai mật khẩu, email không có, chưa đặt mật khẩu, tài khoản đã thu hồi: cùng một câu trả lời invalid", async () => {
    const { s, email } = await withPassword();
    const noPassword = await adminSess("support");
    const revoked = await withPassword("support");
    await sqlAsMigrator(`UPDATE admin_users SET status = 'revoked' WHERE id = $1`, [revoked.s.adminId]);
    for (const [e, p] of [[email, "sai-mat-khau-1"], ["khong-co@x.vn", PW], [await emailOf(noPassword), PW], [revoked.email, PW]]) {
      const res = await tryLogin(e!, p!, `10.9.1.${Math.floor(Math.random() * 200)}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ next: "invalid" });
      expect(cookieValue(res, "__Host-me_admin")).toBeUndefined();
    }
    expect((await auditRows("admin_login")).filter((r) => r.result === "denied").map((r) => r.admin_user_id)).toContain(s.adminId);
  });

  it("sai 5 lần theo email thì khóa (kể cả đúng mật khẩu); 20 lần theo IP thì khóa mọi email từ IP đó", async () => {
    const { email } = await withPassword();
    for (let i = 0; i < 5; i++) await tryLogin(email, `sai-${i}-xxxxx`, `10.9.2.${i}`);
    expect(await (await tryLogin(email, PW, "10.9.2.99")).json()).toEqual({ next: "locked" });

    const other = await withPassword();
    for (let i = 0; i < 20; i++) await tryLogin(`ai-do-${i}@x.vn`, "sai-mat-khau", "10.9.3.1");
    expect(await (await tryLogin(other.email, PW, "10.9.3.1")).json()).toEqual({ next: "locked" });
    expect(await (await tryLogin(other.email, PW, "10.9.3.2")).json()).toEqual({ next: "done" });
  }, 60_000);

  it("đặt mật khẩu: cần đăng nhập gần đây, chặn mật khẩu yếu, hủy phiên khác, giữ phiên hiện tại, có nhật ký", async () => {
    const s = await adminSess("owner");
    const email = await emailOf(s);
    const other = await adminSess("owner");
    await sqlAsMigrator(`UPDATE admin_sessions SET admin_user_id = $1 WHERE admin_user_id = $2`, [s.adminId, other.adminId]);
    for (const [pw, problem] of [["ngan", "too_short"], ["12345678", "common"], [email, "email"], [email.split("@")[0]!.padEnd(8, "1") === email.split("@")[0] ? "x" : email.split("@")[0]!, null]] as const) {
      if (problem === null) continue;
      const res = await callAdmin(setPassword, s, "POST", "/api/quan-tri/me/password", { password: pw });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "weak_password", problem });
    }
    expect((await callAdmin(setPassword, s, "POST", "/api/quan-tri/me/password", { password: PW })).status).toBe(200);
    expect(await validateSession("admin", s.token)).not.toBeNull();
    expect(await validateSession("admin", other.token)).toBeNull();
    expect((await auditRows("admin_password_set")).at(-1)).toMatchObject({ admin_user_id: s.adminId, result: "ok" });

    await sqlAsMigrator(`UPDATE admin_sessions SET auth_at = now() - interval '11 minutes' WHERE admin_user_id = $1`, [s.adminId]);
    const stale = await callAdmin(setPassword, s, "POST", "/api/quan-tri/me/password", { password: "mot-mat-khau-khac" });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toEqual({ error: "reauth_required" });
  });

  it("hỗ trợ đặt được mật khẩu của chính mình; phiên học viên không gọi được API đặt mật khẩu", async () => {
    const { email } = await withPassword("support");
    expect(await (await tryLogin(email, PW, "10.9.4.1")).json()).toEqual({ next: "done" });
    const res = await setPassword(new Request(`${ORIGIN}/api/quan-tri/me/password`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", cookie: "__Host-me_learn=abc" },
      body: JSON.stringify({ password: PW }),
    }));
    expect(res.status).toBe(401);
  });

  it("đăng nhập từ nguồn lạ bị chặn", async () => {
    const { email } = await withPassword();
    const res = await login(new Request(`${ORIGIN}/api/auth/admin/password/login`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ email, password: PW }),
    }));
    expect(res.status).toBe(403);
  });

  it("job dọn xóa lượt thử quản trị quá 30 ngày", async () => {
    await sqlAsMigrator(`INSERT INTO admin_login_attempts (email_lower, ip, ok, at) VALUES
      ('a@x.vn', '10.1.1.1', false, now() - interval '31 days'), ('a@x.vn', '10.1.1.1', false, now() - interval '1 day')`);
    const job = JOBS.find((j) => j.name === "me.auth.prune-password-attempts")!;
    await job.run({} as never);
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_login_attempts`)).rows[0].n).toBe(1);
  });

  it("thu hồi rồi mời lại, kích hoạt lại: mật khẩu cũ mất hiệu lực, hasPassword false", async () => {
    const owner = await adminSess("owner");
    const { s, email } = await withPassword("support");
    await sqlAsMigrator(`SELECT admin_change($1, $2, NULL, 'revoked')`, [owner.adminId, s.adminId]);
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_passwords WHERE admin_user_id = $1`, [s.adminId])).rows[0].n).toBe(0);
    await sqlAsMigrator(`SELECT admin_invite($1, $2, 'support')`, [owner.adminId, email]);
    await sqlAsMigrator(`SELECT admin_activate($1)`, [s.adminId]);
    expect(await (await tryLogin(email, PW, "10.9.5.1")).json()).toEqual({ next: "invalid" });
    const fresh = { adminId: s.adminId, ...(await adminSession(s.adminId)) };
    expect(await (await callAdmin(me, fresh, "GET", "/api/quan-tri/me")).json()).toMatchObject({ hasPassword: false });
  });

  it("thu hồi đang chạy song song với đăng nhập: đăng nhập chờ rồi bị từ chối, không có phiên", async () => {
    const owner = await adminSess("owner");
    const { s, email } = await withPassword("support");
    const holder = await pgAs("migrator");
    try {
      await holder.query("BEGIN");
      await holder.query(`SELECT admin_change($1, $2, NULL, 'revoked')`, [owner.adminId, s.adminId]);
      const pending = tryLogin(email, PW, "10.9.6.1");
      await new Promise((r) => setTimeout(r, 800));
      await holder.query("COMMIT");
      const res = await pending;
      expect(await res.json()).toEqual({ next: "invalid" });
      expect(cookieValue(res, "__Host-me_admin")).toBeUndefined();
    } finally {
      await holder.end();
    }
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_sessions WHERE admin_user_id = $1 AND revoked_at IS NULL`, [s.adminId])).rows[0].n).toBe(0);
  });

  it("mọi lần sai đều ghi nhật ký từ chối, kể cả email không có (cùng một đường xử lý)", async () => {
    const before = (await auditRows("admin_login")).length;
    await tryLogin("khong-ai-co@x.vn", PW, "10.9.7.1");
    const rows = await auditRows("admin_login");
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ admin_user_id: null, result: "denied", reason: "password" });
  });
});

