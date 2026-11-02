import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { changeAdmin, inviteAdmin } from "@/modules/auth-admin/admins";
import { validateSession } from "@/modules/sessions/sessions";
import { consumeAdminLink } from "@/modules/auth-admin/email-link";
import { bootstrapOwner, issueLoginLink, recoverOwner } from "@/worker/cli";
import { adminRow, adminSession, ageInvite, auditRows, insertAdmin, ownerCtx } from "../helpers/admin";
import { errCode, pgAs } from "../helpers/pg";
import { sqlAsMigrator } from "../helpers/otp";

const DAY = 86_400_000;
const MARGIN = 1_000;

async function withMigrator<T>(run: (c: Client) => Promise<T>): Promise<T> {
  const client = await pgAs("migrator");
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

describe("CLI in link đăng nhập quản trị (thay email khi chưa có G7)", () => {
  const opts = () => ({ adminKey: process.env.SESSION_KEY_ADMIN!, origin: process.env.APP_ORIGIN! });

  it("in link 15 phút cho quản trị viên đang hoạt động; link dùng được đúng một lần; link cũ bị hủy; có nhật ký", async () => {
    await withMigrator((c) => bootstrapOwner(c, "chu@x.vn"));
    const first = await withMigrator((c) => issueLoginLink(c, " Chu@X.vn ", opts()));
    const second = await withMigrator((c) => issueLoginLink(c, "chu@x.vn", opts()));
    if (typeof first !== "string" || typeof second !== "string") throw new Error("không in được link");
    expect(second).toMatch(new RegExp(`^${process.env.APP_ORIGIN}/admin/dang-nhap#link=[A-Za-z0-9_-]{43}$`));
    const token = (url: string) => url.split("#link=")[1]!;
    expect(await consumeAdminLink(token(first))).toBeNull();
    expect(await consumeAdminLink(token(second))).not.toBeNull();
    expect(await consumeAdminLink(token(second))).toBeNull();
    expect((await auditRows("cli_login_link")).map((r) => [r.result, r.admin_user_id])).toEqual([["ok", null], ["ok", null]]);
  });

  it("email không phải quản trị viên đang hoạt động hay sai dạng → từ chối, không tạo link", async () => {
    expect(await withMigrator((c) => issueLoginLink(c, "la@x.vn", opts()))).toBe("not_found");
    expect(await withMigrator((c) => issueLoginLink(c, "khong-phai-email", opts()))).toBe("not_found");
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_email_links`);
    expect(rows[0].n).toBe(0);
  });
});

describe("CLI khởi tạo và khôi phục", () => {
  it("bootstrap tạo owner; lần hai báo đã có owner", async () => {
    expect(await withMigrator((c) => bootstrapOwner(c, " Chu@X.vn "))).toBe("created");
    expect(await adminRow("chu@x.vn")).toMatchObject({ role: "owner", status: "active" });
    expect(await withMigrator((c) => bootstrapOwner(c, "khac@x.vn"))).toBe("owner_exists");
    expect(await adminRow("khac@x.vn")).toBeUndefined();
    expect(await auditRows("bootstrap")).toMatchObject([{ admin_user_id: null, result: "ok" }]);
  });

  it("recover: thiếu --confirm đúng hoặc lý do ngắn → từ chối; hợp lệ → owner active, phiên cũ null, Google bị gỡ", async () => {
    const id = await insertAdmin("chu@x.vn", "owner", "revoked");
    await insertAdmin("khac@x.vn");
    const s = await adminSession(id);
    await sqlAsMigrator(`INSERT INTO admin_identities (admin_user_id, google_sub) VALUES ($1, 'g-chu')`, [id]);
    const reason = "mất điện thoại có Google";
    expect(await withMigrator((c) => recoverOwner(c, { email: "chu@x.vn", reason, confirm: "sai@x.vn" }))).toBe("rejected");
    expect(await withMigrator((c) => recoverOwner(c, { email: "chu@x.vn", reason: "ngắn", confirm: "chu@x.vn" }))).toBe("rejected");
    expect((await adminRow("chu@x.vn"))!.status).toBe("revoked");
    expect(await withMigrator((c) => recoverOwner(c, { email: "chu@x.vn", reason, confirm: "chu@x.vn" }))).toBe("recovered");
    expect(await adminRow("chu@x.vn")).toMatchObject({ role: "owner", status: "active" });
    expect(await validateSession("admin", s.token)).toBeNull();
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_identities`)).rows[0].n).toBe(0);
    expect(await auditRows("emergency_recover")).toMatchObject([{ result: "ok", reason }]);
  });

  it("recover email chưa có → tạo owner active", async () => {
    const reason = "chủ cũ mất quyền truy cập";
    expect(await withMigrator((c) => recoverOwner(c, { email: "moi@x.vn", reason, confirm: "moi@x.vn" }))).toBe("recovered");
    expect(await adminRow("moi@x.vn")).toMatchObject({ role: "owner", status: "active" });
  });
});

describe("quyền DB", () => {
  it("me_app không UPDATE thẳng admin_users; gọi được admin_change; me_other không gọi được", async () => {
    const owner = await insertAdmin("chu@x.vn");
    const support = await insertAdmin("ho-tro@x.vn", "support");
    const app = await pgAs("app");
    const other = await pgAs("other");
    try {
      expect(await errCode(app, `UPDATE admin_users SET role = 'owner'`)).toBe("42501");
      expect(await errCode(other, `SELECT admin_change($1, $2, NULL, 'revoked')`, [owner, support])).toBe("42501");
      const s = await adminSession(support);
      expect(await errCode(app, `SELECT admin_change($1, $2, NULL, 'revoked')`, [owner, support])).toBeNull();
      expect(await validateSession("admin", s.token)).toBeNull();
      expect(await errCode(app, `SELECT admin_change($1, $2, 'support', NULL)`, [support, owner])).toBe("42501");
    } finally {
      await app.end();
      await other.end();
    }
  });

  it("UPDATE thô bằng me_migrator hạ owner cuối → lỗi trigger", async () => {
    await insertAdmin("chu@x.vn");
    const code = await withMigrator((c) => errCode(c, `UPDATE admin_users SET role = 'support'`));
    expect(code).toBe("P0001");
  });
});

describe("mời quản trị", () => {
  it("email mới → invited; email sai → invalid_email; đã active → already_active", async () => {
    const ctx = await ownerCtx();
    expect(await inviteAdmin(ctx, { email: " Ho.Tro@X.vn ", role: "support" })).toBe("invited");
    expect(await adminRow("ho.tro@x.vn")).toMatchObject({ role: "support", status: "invited" });
    expect(await inviteAdmin(ctx, { email: "khong-hop-le", role: "support" })).toBe("invalid_email");
    expect(await inviteAdmin(ctx, { email: "chu@x.vn", role: "support" })).toBe("already_active");
    expect((await auditRows("admin_invite")).map((r) => r.result)).toEqual(["ok", "ok"]);
  });

  it("lời mời quá hạn tự nhiên: mời lại đúng lúc hết hạn → hạn mới; trước đó 1 giây → giữ hạn cũ", async () => {
    const ctx = await ownerCtx();
    await inviteAdmin(ctx, { email: "a@x.vn", role: "support" });
    await ageInvite("a@x.vn", 7 * DAY - MARGIN);
    const before = (await adminRow("a@x.vn"))!.invite_expires_at;
    await inviteAdmin(ctx, { email: "a@x.vn", role: "owner" });
    const kept = (await adminRow("a@x.vn"))!;
    expect(kept.invite_expires_at).toEqual(before);
    expect(kept.role).toBe("owner");
    await ageInvite("a@x.vn", MARGIN);
    await inviteAdmin(ctx, { email: "a@x.vn", role: "support" });
    const renewed = (await adminRow("a@x.vn"))!;
    expect(renewed.status).toBe("invited");
    expect(renewed.invite_expires_at.getTime()).toBeGreaterThan(Date.now() + 7 * DAY - 60_000);
  });

  it("mời lại email expired/revoked → invited mới, link cũ bị hủy, phiên cũ thu hồi", async () => {
    const ctx = await ownerCtx();
    for (const status of ["expired", "revoked"]) {
      const email = `${status}@x.vn`;
      const id = await insertAdmin(email, "support", status);
      const s = await adminSession(id);
      await sqlAsMigrator(
        `INSERT INTO admin_email_links (token_hash, admin_user_id, expires_at) VALUES ($1, $2, now() + interval '15 minutes')`,
        [`h-${status}`, id],
      );
      expect(await inviteAdmin(ctx, { email, role: "support" })).toBe("invited");
      expect((await adminRow(email))!.status).toBe("invited");
      const { rows } = await sqlAsMigrator(`SELECT invalidated_at FROM admin_email_links WHERE admin_user_id = $1`, [id]);
      expect(rows[0].invalidated_at).not.toBeNull();
      expect(await validateSession("admin", s.token)).toBeNull();
    }
  });

  it("mời song song cùng email (mới hoặc mời lại) → một bản ghi, không lỗi", async () => {
    const ctx = await ownerCtx();
    const results = await Promise.all([1, 2, 3].map(() => inviteAdmin(ctx, { email: "song@x.vn", role: "support" })));
    expect(results).toEqual(["invited", "invited", "invited"]);
    await ageInvite("song@x.vn", 7 * DAY);
    await Promise.all([1, 2].map(() => inviteAdmin(ctx, { email: "song@x.vn", role: "support" })));
    const { rows } = await sqlAsMigrator(`SELECT invite_expires_at FROM admin_users WHERE email_lower = 'song@x.vn'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].invite_expires_at.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("đổi quyền và chủ cuối", () => {
  it("hạ owner duy nhất → last_owner + audit denied", async () => {
    const ctx = await ownerCtx();
    expect(await changeAdmin(ctx, ctx.adminId, { role: "support" })).toBe("last_owner");
    expect((await adminRow("chu@x.vn"))!.role).toBe("owner");
    expect(await auditRows("admin_change")).toMatchObject([{ result: "denied", target_id: ctx.adminId }]);
  });

  it("hai owner hạ quyền nhau song song → còn đúng một owner", async () => {
    const a = await ownerCtx("a@x.vn");
    const b = await ownerCtx("b@x.vn");
    const results = await Promise.all([
      changeAdmin(a, b.adminId, { role: "support" }),
      changeAdmin(b, a.adminId, { role: "support" }),
    ]);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_users WHERE role = 'owner' AND status = 'active'`);
    expect(rows[0].n).toBe(1);
    expect(results.sort()).toEqual(["not_owner", "ok"]);
    expect((await auditRows("admin_change")).map((r) => r.result).sort()).toEqual(["denied", "ok"]);
  });

  it("đổi role → mọi phiên quản trị của người đó null ngay; audit ok", async () => {
    const ctx = await ownerCtx();
    const target = await insertAdmin("b@x.vn", "owner");
    const [s1, s2] = [await adminSession(target), await adminSession(target)];
    expect(await changeAdmin(ctx, target, { role: "support" })).toBe("ok");
    expect(await validateSession("admin", s1.token)).toBeNull();
    expect(await validateSession("admin", s2.token)).toBeNull();
    expect(await validateSession("admin", ctx.token)).not.toBeNull();
    expect(await auditRows("admin_change")).toMatchObject([{ result: "ok", target_id: target }]);
  });
});
