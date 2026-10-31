import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { errCode, pgAs } from "../helpers/pg";

let app: Client;
beforeAll(async () => {
  app = await pgAs("app");
});
afterAll(async () => {
  await app.end();
});

describe("quyền của vai trò me_app", () => {
  it("không TRUNCATE được", async () => {
    expect(await errCode(app, "TRUNCATE users")).toBe("42501");
  });
  it("không tạo bảng được", async () => {
    expect(await errCode(app, "CREATE TABLE x_test ()")).toBe("42501");
  });
  it("không DELETE nhật ký quản trị", async () => {
    expect(await errCode(app, "DELETE FROM admin_audit_log")).toBe("42501");
  });
  it("không UPDATE admin_users", async () => {
    expect(await errCode(app, "UPDATE admin_users SET role = 'owner'")).toBe("42501");
  });
  it("được DELETE login_tickets", async () => {
    expect(await errCode(app, "DELETE FROM login_tickets")).toBeNull();
  });
  it("được INSERT users", async () => {
    expect(await errCode(app, "INSERT INTO users (display_name) VALUES ('ok')")).toBeNull();
  });
});

describe("vai trò sao lưu me_backup", () => {
  it("đọc được mọi bảng, kể cả bảng tạo sau; không ghi, không DDL", async () => {
    const backup = await pgAs("backup");
    const migrator = await pgAs("migrator");
    try {
      expect(await errCode(backup, "SELECT count(*) FROM bank_transactions")).toBeNull();
      expect(await errCode(backup, "SELECT count(*) FROM admin_audit_log")).toBeNull();
      await migrator.query("CREATE TABLE bang_moi_sau (id int)");
      expect(await errCode(backup, "SELECT count(*) FROM bang_moi_sau")).toBeNull();
      expect(await errCode(backup, "INSERT INTO users (display_name) VALUES ('x')")).toBe("42501");
      expect(await errCode(backup, "UPDATE orders SET status = status")).toBe("42501");
      expect(await errCode(backup, "DELETE FROM job_runs")).toBe("42501");
      expect(await errCode(backup, "CREATE TABLE bang_cua_backup (id int)")).toBe("42501");
    } finally {
      await backup.end();
      await migrator.end();
    }
  });
});

