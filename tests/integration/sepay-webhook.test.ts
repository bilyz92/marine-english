import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/payments/sepay/webhook/route";
import { paidCourseSetup, PRICE } from "../helpers/ledger";

const NEW_SECRET = "bi-mat-moi-dung-trong-test";
const OLD_SECRET = "bi-mat-cu-dung-trong-test";
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  for (const m of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logged.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")));
  }
});
afterEach(() => vi.restoreAllMocks());

/** Giờ Việt Nam dạng SePay: 'YYYY-MM-DD HH:mm:ss'. */
function vnTime(d: Date): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

function payload(code: string, at: Date, patch: Record<string, unknown> = {}) {
  return {
    id: Math.floor(Math.random() * 1e9), gateway: "VCB", transactionDate: vnTime(at), accountNumber: "0123456789",
    code: null, content: `Thanh toan ${code} chuyen khoan`, transferType: "in", transferAmount: PRICE, accumulated: 0,
    subAccount: null, referenceCode: `FT${Math.floor(Math.random() * 1e9)}`, description: "",
    ...patch,
  };
}

function signed(body: string, opts: { secret?: string; skewSec?: number; contentType?: string; signature?: string; prefix?: string } = {}) {
  const ts = String(Math.floor(Date.now() / 1000) + (opts.skewSec ?? 0));
  const sig = opts.signature ?? `${opts.prefix ?? ""}${createHmac("sha256", opts.secret ?? NEW_SECRET).update(`${ts}.${body}`).digest("hex")}`;
  return new Request(`${process.env.APP_ORIGIN}/api/payments/sepay/webhook`, {
    method: "POST",
    headers: { "content-type": opts.contentType ?? "application/json", "x-sepay-timestamp": ts, "x-sepay-signature": sig },
    body,
  });
}

const allocations = () => prisma().paymentAllocation.count();

describe("webhook SePay", () => {
  it("chữ ký đúng (khóa mới hoặc khóa cũ) → 200, đơn paid; log không chứa nội dung chuyển khoản", async () => {
    const s = await paidCourseSetup();
    const body = JSON.stringify(payload(s.code, new Date(s.createdAt.getTime() + 60_000)));
    const res = await POST(signed(body, { secret: OLD_SECRET }));
    expect([res.status, await res.json()]).toEqual([200, { success: true }]);
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
    expect(logged.join("\n")).not.toContain(s.code);
  });

  it("chữ ký dạng SePay gửi thật: \"sha256=<hex>\" (developer.sepay.vn/vi/sepay-webhooks/xac-thuc) → 200, đơn paid", async () => {
    const s = await paidCourseSetup();
    const body = JSON.stringify(payload(s.code, new Date(s.createdAt.getTime() + 60_000)));
    const res = await POST(signed(body, { prefix: "sha256=" }));
    expect([res.status, await res.json()]).toEqual([200, { success: true }]);
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
  });

  it("sửa body sau khi ký, thiếu header, sai khóa → 401", async () => {
    const s = await paidCourseSetup();
    const body = JSON.stringify(payload(s.code, new Date()));
    const req = signed(body);
    const tampered = new Request(req.url, { method: "POST", headers: req.headers, body: body.replace(String(PRICE), "1") });
    expect((await POST(tampered)).status).toBe(401);
    expect((await POST(signed(body, { secret: "sai" }))).status).toBe(401);
    expect((await POST(new Request(req.url, { method: "POST", headers: { "content-type": "application/json" }, body }))).status).toBe(401);
    expect(await allocations()).toBe(0);
    expect(logged.join("\n")).not.toContain(s.code);
  });

  it("timestamp lệch 301 giây → 401; 290 giây → 200", async () => {
    const s = await paidCourseSetup();
    const body = JSON.stringify(payload(s.code, new Date(s.createdAt.getTime() + 60_000)));
    expect((await POST(signed(body, { skewSec: -301 }))).status).toBe(401);
    expect((await POST(signed(body, { skewSec: 301 }))).status).toBe(401);
    expect((await POST(signed(body, { skewSec: -290 }))).status).toBe(200);
  });

  it("JSON hỏng có chữ ký đúng → 400; text/plain → 415; quá 64 KB → 413", async () => {
    await paidCourseSetup();
    expect((await POST(signed("{khong-phai-json"))).status).toBe(400);
    expect((await POST(signed(JSON.stringify({ id: 1 })))).status).toBe(400);
    expect((await POST(signed("{}", { contentType: "text/plain" }))).status).toBe(415);
    expect((await POST(signed(JSON.stringify({ pad: "x".repeat(70_000) })))).status).toBe(413);
  });

  it("gửi lại 3 lần và 2 request song song → một phân bổ, luôn 200", async () => {
    const s = await paidCourseSetup();
    const body = JSON.stringify(payload(s.code, new Date(s.createdAt.getTime() + 60_000)));
    const statuses = await Promise.all([POST(signed(body)), POST(signed(body))].map(async (p) => (await p).status));
    for (let i = 0; i < 3; i++) statuses.push((await POST(signed(body))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(await allocations()).toBe(1);
  });

  it("transactionDate sai định dạng → 200, ghi observation thiếu thời điểm; tiền ra → 200 ignored", async () => {
    const s = await paidCourseSetup();
    expect((await POST(signed(JSON.stringify(payload(s.code, new Date(), { transactionDate: "30/10/2026" }))))).status).toBe(200);
    expect((await POST(signed(JSON.stringify(payload(s.code, new Date(), { transferType: "out" }))))).status).toBe(200);
    const obs = await prisma().bankTransactionObservation.findMany({ orderBy: { receivedAt: "asc" } });
    expect(obs.map((o) => [o.unresolvedReason, o.ignoredReason])).toEqual([["missing_time", null], [null, "outgoing"]]);
  });

  it("chưa cấu hình bí mật → 503", async () => {
    vi.stubEnv("SEPAY_WEBHOOK_SECRETS", "");
    vi.resetModules();
    try {
      const { POST: fresh } = await import("@/app/api/payments/sepay/webhook/route");
      expect((await fresh(signed("{}"))).status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
