import { describe, expect, it } from "vitest";
import { Client } from "pg";
import { loginAdminWithPassword } from "@/modules/auth-admin/password";
import { validateSession } from "@/modules/sessions/sessions";
import { setAdminPassword } from "@/worker/cli";
import { adminSession, auditRows, insertAdmin } from "../helpers/admin";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

// Lệnh máy chủ admin:set-password: mật khẩu tạm cho quản trị đang hoạt động (chủ chưa đặt được, hoặc quên mật khẩu).
async function withMigrator<T>(run: (c: Client) => Promise<T>): Promise<T> {
  const client = await pgAs("migrator");
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

describe("CLI đặt mật khẩu tạm cho quản trị", () => {
  it("sinh mật khẩu ngẫu nhiên đủ dài, đăng nhập được, thu hồi phiên cũ, có nhật ký; mỗi lần một mật khẩu khác", async () => {
    const id = await insertAdmin("chu@x.vn");
    const old = await adminSession(id);
    const first = await withMigrator((c) => setAdminPassword(c, " Chu@X.vn "));
    if (first === "not_found") throw new Error("không có admin");
    expect(first.password.length).toBeGreaterThanOrEqual(16);
    expect(await validateSession("admin", old.token)).toBeNull();
    expect(await loginAdminWithPassword({ email: "chu@x.vn", password: first.password, ip: "10.8.0.1" })).toMatchObject({ kind: "ok" });
    expect((await auditRows("cli_set_password")).at(-1)).toMatchObject({ admin_user_id: null, target_id: id, result: "ok" });
    const hash = (await sqlAsMigrator(`SELECT password_hash FROM admin_passwords WHERE admin_user_id = $1`, [id])).rows[0].password_hash as string;
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain(first.password);

    const second = await withMigrator((c) => setAdminPassword(c, "chu@x.vn"));
    if (second === "not_found") throw new Error("không có admin");
    expect(second.password).not.toBe(first.password);
    expect(await loginAdminWithPassword({ email: "chu@x.vn", password: first.password, ip: "10.8.0.2" })).toEqual({ kind: "invalid" });
  });

  it("email không có, đã thu hồi hoặc chỉ đang mời → not_found, không ghi gì", async () => {
    await insertAdmin("thuhoi@x.vn", "support", "revoked");
    await insertAdmin("moi@x.vn", "support", "invited");
    for (const email of ["khong-co@x.vn", "thuhoi@x.vn", "moi@x.vn", "khong-phai-email"]) {
      expect(await withMigrator((c) => setAdminPassword(c, email))).toBe("not_found");
    }
    expect((await sqlAsMigrator(`SELECT count(*)::int AS n FROM admin_passwords`)).rows[0].n).toBe(0);
  });
});
