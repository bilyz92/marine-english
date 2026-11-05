import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, withTx } from "@/lib/db";
import { HttpError, json, route } from "@/lib/http";
import { classifyPath } from "@/modules/sessions/routes";
import { requireAdmin, requireLearner } from "@/modules/sessions/guards";
import { createSession } from "@/modules/sessions/sessions";
import { proxy } from "@/proxy";
import { pgAs } from "../helpers/pg";

const ORIGIN = process.env.APP_ORIGIN!;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("classifyPath", () => {
  it.each([
    ["/", "public"],
    ["/khoa-hoc/may-chinh", "public"],
    ["/dang-nhap", "public"],
    ["/dang-nhap/ma", "public"],
    ["/admin/dang-nhap", "public"],
    ["/_next/static/x.js", "public"],
    ["/api/public/courses", "public"],
    ["/api/health", "public"],
    ["/api/payments/sepay/webhook", "provider"],
    ["/api/auth/learner/otp", "auth"],
    ["/api/auth/admin/link", "auth"],
    // Mua khóa không cần đăng nhập trước (2026-11-05): trang mua công khai; thanh toán, học, API của học viên vẫn cần phiên.
    ["/mua/engine_cadet_tanker", "public"],
    ["/thanh-toan/ME7K3QX9AB", "learner"],
    ["/api/me/orders", "learner"],
    ["/hoc/bai-1", "learner"],
    ["/tai-khoan", "learner"],
    ["/api/learn/sync", "learner"],
    ["/api/me/identities", "learner"],
    ["/admin", "admin"],
    ["/admin/don-hang", "admin"],
    ["/api/quan-tri/admins", "admin"],
    ["/api/khong-co", "denied"],
    ["/api", "denied"],
    ["/gioi-thieu", "public"],
    ["/hocx", "public"],
    ["/quan-tri-x", "public"],
  ])("%s → %s", (path, expected) => {
    expect(classifyPath(path)).toBe(expected);
  });

  it("/dev/** chỉ mở khi development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(classifyPath("/dev/thu")).toBe("public");
    vi.stubEnv("NODE_ENV", "production");
    expect(classifyPath("/dev/thu")).toBe("denied");
  });
});

describe("proxy", () => {
  const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`${ORIGIN}${path}`, { headers });

  it("/api/khong-co → 404; /dev/thu khi production → 404", async () => {
    expect((await proxy(req("/api/khong-co"))).status).toBe(404);
    vi.stubEnv("NODE_ENV", "production");
    expect((await proxy(req("/dev/thu"))).status).toBe(404);
  });

  it("xóa header x-me-* do client gửi rồi mới gắn x-me-realm", async () => {
    const res = await proxy(req("/api/me/identities", { "x-me-realm": "admin", "x-me-other": "1", cookie: "__Host-me_learn=t" }));
    expect(res.headers.get("x-middleware-request-x-me-realm")).toBe("learner");
    expect(res.headers.get("x-middleware-request-x-me-other")).toBeNull();
  });

  it("API khu vực riêng thiếu cookie đúng khu vực → 401", async () => {
    expect((await proxy(req("/api/quan-tri/admins", { cookie: "__Host-me_learn=t" }))).status).toBe(401);
    expect((await proxy(req("/api/me/identities", { cookie: "__Host-me_admin=t" }))).status).toBe(401);
  });

  it("chỉ đường dẫn tải gói nội dung được bỏ qua proxy", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/api/quan-tri/content/import")).toBe(false);
    for (const p of ["/api/quan-tri/content/import/x", "/api/quan-tri/content/importer", "/api/quan-tri/admins", "/admin"]) expect(re.test(p)).toBe(true);
  });

  it("đường dẫn cũ /quan-tri/** chuyển hẳn sang /admin/**, giữ query; API /api/quan-tri không đổi", async () => {
    for (const [from, to] of [
      ["/quan-tri", "/admin"],
      ["/quan-tri/dang-nhap?next=%2Fadmin", "/admin/dang-nhap?next=%2Fadmin"],
      ["/quan-tri/quan-tri-vien", "/admin/quan-tri-vien"],
    ]) {
      const res = await proxy(req(from!));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`${ORIGIN}${to}`);
    }
    expect((await proxy(req("/quan-tri-x"))).status).toBe(200);
    expect((await proxy(req("/api/quan-tri/admins"))).status).toBe(401);
  });
});

async function learnerSession() {
  const user = await prisma().user.create({ data: { displayName: "HV" } });
  const device = await prisma().device.create({ data: { userId: user.id, deviceKeyHash: "k", label: "đt" } });
  return withTx((tx) => createSession(tx, { realm: "learner", userId: user.id, deviceId: device.id, authAt: new Date() }));
}

async function adminSession() {
  const client = await pgAs("migrator");
  const { rows } = await client.query(
    `INSERT INTO admin_users (email_lower, role, status, invited_at, invite_expires_at)
     VALUES ('chu@x.vn', 'owner', 'active', now(), now() + interval '7 days') RETURNING id`,
  );
  await client.end();
  return withTx((tx) => createSession(tx, { realm: "admin", adminId: rows[0].id, authAt: new Date() }));
}

// Handler mẫu: gọi thẳng, không qua proxy.
const adminOnly = route(async (req) => json({ id: (await requireAdmin(req)).adminId }));
const learnerOnly = route(async (req) => json({ id: (await requireLearner(req)).userId }));

function call(handler: typeof adminOnly, init: { method?: string; cookie?: string; headers?: Record<string, string> }) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return handler(new Request(`${ORIGIN}/api/x`, { method: init.method ?? "GET", headers }));
}

describe("guard theo khu vực (gọi handler trực tiếp)", () => {
  it("chỉ cookie học viên → handler quản trị 401; chỉ cookie quản trị → handler học viên 401", async () => {
    const l = await learnerSession();
    const a = await adminSession();
    expect((await call(adminOnly, { cookie: `__Host-me_learn=${l.token}` })).status).toBe(401);
    expect((await call(learnerOnly, { cookie: `__Host-me_admin=${a.token}` })).status).toBe(401);
  });

  it("có cả hai cookie → mỗi bên chỉ nhận đúng khu vực", async () => {
    const l = await learnerSession();
    const a = await adminSession();
    const cookie = `__Host-me_learn=${l.token}; __Host-me_admin=${a.token}`;
    expect((await call(adminOnly, { cookie })).status).toBe(200);
    expect((await call(learnerOnly, { cookie })).status).toBe(200);
  });

  it("token học viên đặt vào cookie quản trị, kèm x-me-realm: admin → vẫn 401", async () => {
    const l = await learnerSession();
    const res = await call(adminOnly, { cookie: `__Host-me_admin=${l.token}`, headers: { "x-me-realm": "admin" } });
    expect(res.status).toBe(401);
  });

  it("không có cookie → 401 với JSON lỗi", async () => {
    const res = await call(learnerOnly, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it("POST: thiếu x-csrf-token → 403; sai Origin → 403; đủ → 200", async () => {
    const l = await learnerSession();
    const cookie = `__Host-me_learn=${l.token}`;
    expect((await call(learnerOnly, { method: "POST", cookie, headers: { origin: ORIGIN } })).status).toBe(403);
    const csrf = { "x-csrf-token": l.csrf };
    expect((await call(learnerOnly, { method: "POST", cookie, headers: { ...csrf, origin: "https://evil.vn" } })).status).toBe(403);
    expect((await call(learnerOnly, { method: "POST", cookie, headers: csrf })).status).toBe(403);
    expect((await call(learnerOnly, { method: "POST", cookie, headers: { ...csrf, origin: ORIGIN } })).status).toBe(200);
  });

  it("HttpError mang mã trạng thái", () => {
    expect(new HttpError(403, "x").status).toBe(403);
  });
});
