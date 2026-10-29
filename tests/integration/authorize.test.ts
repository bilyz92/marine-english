import { describe, expect, it } from "vitest";
import { withTx } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { authorize, POLICY, PERMISSIONS } from "@/modules/auth-admin/authorize";
import { createSession } from "@/modules/sessions/sessions";
import type { AdminCtx } from "@/modules/sessions/guards";
import { GET, PATCH, POST } from "@/app/api/quan-tri/admins/route";
import { adminRow, auditRows, insertAdmin } from "../helpers/admin";

const MIN = 60_000;
const MARGIN = 1_000;
const ORIGIN = process.env.APP_ORIGIN!;

async function sessionFor(email: string, role: "owner" | "support", authAt = new Date()) {
  const adminId = await insertAdmin(email, role);
  const s = await withTx((tx) => createSession(tx, { realm: "admin", adminId, authAt }));
  return { adminId, ...s };
}

function call(handler: typeof POST, s: { token: string; csrf: string }, method: string, body?: unknown) {
  return handler(
    new Request(`${ORIGIN}/api/quan-tri/admins`, {
      method,
      headers: { cookie: `__Host-me_admin=${s.token}`, origin: ORIGIN, "x-csrf-token": s.csrf, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const ctxOf = (adminId: string, role: "owner" | "support", authAt = new Date()): AdminCtx => ({
  adminId, role, sessionId: crypto.randomUUID(), authAt, ip: "10.0.0.1",
});

async function rejection(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return error.message;
    throw error;
  }
}

describe("POLICY", () => {
  it("mọi Permission có mục; owner có mọi quyền", () => {
    expect(Object.keys(POLICY).sort()).toEqual([...PERMISSIONS].sort());
    for (const perm of PERMISSIONS) expect(POLICY[perm].roles).toContain("owner");
  });

  it("support chỉ có các quyền đã định", () => {
    const support = PERMISSIONS.filter((p) => POLICY[p].roles.includes("support")).sort();
    expect(support).toEqual(["bank.raw.view", "devices.remove", "learner.phone.view", "orders.view", "payments.match", "refunds.request"]);
  });
});

describe("authorize", () => {
  it("support bank.raw.view: tài nguyên giao cho mình → được; giao người khác → 403 condition + audit", async () => {
    const id = await insertAdmin("ho-tro@x.vn", "support");
    const ctx = ctxOf(id, "support");
    await authorize(ctx, "bank.raw.view", { action: "bank.raw.view", resource: { type: "bank_tx", id: "t1", assignedAdminId: id } });
    expect(
      await rejection(
        authorize(ctx, "bank.raw.view", { action: "bank.raw.view", resource: { type: "bank_tx", id: "t2", assignedAdminId: crypto.randomUUID() } }),
      ),
    ).toBe("condition");
    expect(await rejection(authorize(ctx, "bank.raw.view", { action: "bank.raw.view" }))).toBe("condition");
    expect(await auditRows("bank.raw.view")).toMatchObject([
      { result: "denied", reason: "condition", target_id: "t2" },
      { result: "denied", reason: "condition" },
    ]);
  });

  it("support jobs.run → 403 role", async () => {
    const id = await insertAdmin("ho-tro@x.vn", "support");
    expect(await rejection(authorize(ctxOf(id, "support"), "jobs.run", { action: "jobs.run" }))).toBe("role");
  });
});

describe("API /api/quan-tri/admins", () => {
  it("support POST → 403 role + audit denied", async () => {
    await insertAdmin("chu@x.vn");
    const s = await sessionFor("ho-tro@x.vn", "support");
    const res = await call(POST, s, "POST", { email: "moi@x.vn", role: "support" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "role" });
    expect(await adminRow("moi@x.vn")).toBeUndefined();
    expect(await auditRows("admin_invite")).toMatchObject([{ result: "denied", reason: "role", admin_user_id: s.adminId }]);
  });

  it("owner xác thực 10 phút trước → 403 reauth_required + audit; 10 phút − 1 giây → được", async () => {
    const stale = await sessionFor("chu@x.vn", "owner", new Date(Date.now() - 10 * MIN));
    const res = await call(POST, stale, "POST", { email: "moi@x.vn", role: "support" });
    expect([res.status, await res.json()]).toEqual([403, { error: "reauth_required" }]);
    expect(await auditRows("admin_invite")).toMatchObject([{ result: "denied", reason: "reauth_required" }]);

    const fresh = await sessionFor("chu2@x.vn", "owner", new Date(Date.now() - 10 * MIN + MARGIN));
    const ok = await call(POST, fresh, "POST", { email: "moi@x.vn", role: "support" });
    expect([ok.status, await ok.json()]).toEqual([200, { result: "invited" }]);
    expect(await adminRow("moi@x.vn")).toMatchObject({ status: "invited", role: "support" });
  });

  it("GET liệt kê admin; PATCH hạ owner cuối → 409 + audit denied; PATCH hợp lệ → 200", async () => {
    const owner = await sessionFor("chu@x.vn", "owner");
    const support = await insertAdmin("ho-tro@x.vn", "support");
    const list = await call(GET, owner, "GET");
    expect(((await list.json()) as { admins: { email: string }[] }).admins.map((a) => a.email).sort()).toEqual(["chu@x.vn", "ho-tro@x.vn"]);

    const last = await call(PATCH, owner, "PATCH", { adminId: owner.adminId, role: "support" });
    expect([last.status, await last.json()]).toEqual([409, { error: "last_owner" }]);
    expect(await auditRows("admin_change")).toMatchObject([{ result: "denied", reason: "last_owner" }]);

    const revoke = await call(PATCH, owner, "PATCH", { adminId: support, status: "revoked" });
    expect(revoke.status).toBe(200);
    expect((await adminRow("ho-tro@x.vn"))!.status).toBe("revoked");
  });

  it("PATCH không cho đặt status khác revoked; POST email sai → 400", async () => {
    const owner = await sessionFor("chu@x.vn", "owner");
    const support = await insertAdmin("ho-tro@x.vn", "support", "revoked");
    expect((await call(PATCH, owner, "PATCH", { adminId: support, status: "active" })).status).toBe(400);
    expect((await call(POST, owner, "POST", { email: "rac", role: "support" })).status).toBe(400);
  });

  it("PATCH admin không tồn tại → 404", async () => {
    const owner = await sessionFor("chu@x.vn", "owner");
    expect((await call(PATCH, owner, "PATCH", { adminId: crypto.randomUUID(), status: "revoked" })).status).toBe(404);
  });

  it("không có phiên quản trị → 401", async () => {
    const res = await GET(new Request(`${ORIGIN}/api/quan-tri/admins`));
    expect(res.status).toBe(401);
  });
});
