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
