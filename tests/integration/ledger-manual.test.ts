import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ingest } from "@/modules/ledger/ingest";
import { enterStatementLine, verifyStatementLine } from "@/modules/ledger/manual";
import { listQueue, listUnresolved, orderNeedsManual } from "@/modules/ledger/queue";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { paidCourseSetup, PRICE, report } from "../helpers/ledger";

const line = (code: string, bankTime: Date, patch: Record<string, unknown> = {}) => ({
  bankCode: "VCB", accountNo: "0123456789", bankRef: `ST${Math.floor(Math.random() * 1e9)}`, amountVnd: PRICE, bankTime,
  content: `ck ${code}`, evidence: "ảnh sao kê ngày 30/10", ...patch,
});

describe("nhập sao kê và xác minh", () => {
  it("support nhập → unverified, hiện trong hàng chờ; chủ khác xác minh → đơn paid", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const owner = await adminCtx("owner");
    const input = line(s.code, new Date(s.createdAt.getTime() + 60_000));
    expect(await enterStatementLine(support, input)).toBe("unverified");
    const [row] = await listQueue();
    expect(row).toMatchObject({ reason: "unverified", amountVnd: PRICE });
    expect(await verifyStatementLine(owner, row!.bankTransactionId, "đối chiếu sao kê")).toEqual({ result: "verified", outcome: "confirmed" });
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("paid");
    expect(await listQueue()).toEqual([]);
    expect(await verifyStatementLine(owner, row!.bankTransactionId, "lần hai")).toEqual({ result: "already_verified" });
    expect((await auditRows("ledger_enter")).map((r) => r.result)).toEqual(["ok"]);
    expect((await auditRows("ledger_verify")).map((r) => [r.result, r.reason])).toEqual([["ok", "đối chiếu sao kê"], ["denied", "already_verified"]]);
  });

  it("chủ không tự xác minh dòng mình nhập (audit denied); support không xác minh được", async () => {
    const s = await paidCourseSetup();
    const owner = await adminCtx("owner");
    const support = await adminCtx("support");
    await enterStatementLine(owner, line(s.code, new Date()));
    const [row] = await listQueue();
    expect(await verifyStatementLine(owner, row!.bankTransactionId, "x")).toEqual({ result: "self_entered" });
    expect((await auditRows("ledger_verify")).map((r) => [r.result, r.reason])).toEqual([["denied", "self_entered"]]);
    expect(await rejected(verifyStatementLine(support, row!.bankTransactionId, "x"))).toBe("role");
    expect(await verifyStatementLine(owner, crypto.randomUUID(), "x")).toEqual({ result: "not_found" });
  });

  it("nhập trùng định danh dòng từ webhook nhưng lệch tiền → mismatch", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    await ingest(report({ bankRef: "FT555", content: "khong ma", bankTime: new Date("2026-10-30T03:00:00Z") }));
    expect(await enterStatementLine(support, line(s.code, new Date("2026-10-30T03:00:00Z"), { bankRef: "FT555", amountVnd: PRICE + 5 }))).toBe("mismatch");
  });

  it("dữ liệu nhập sai (thiếu bằng chứng, số tiền âm, mã ngân hàng sai) → lỗi 400", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    for (const patch of [{ evidence: " " }, { amountVnd: -1 }, { bankCode: "vcb!" }, { accountNo: "12ab" }]) {
      await expect(enterStatementLine(support, line(s.code, new Date(), patch))).rejects.toMatchObject({ status: 400 });
    }
  });
});

describe("hàng chờ", () => {
  it("chứa giao dịch không mã và giao dịch thiếu tiền; không chứa dòng đã phân bổ; cờ cần xử lý tay của đơn", async () => {
    const s = await paidCourseSetup();
    const t = new Date(s.createdAt.getTime() + 60_000);
    await ingest(report({ content: "chuyen tien hoc", bankTime: t }));
    await ingest(report({ content: s.code, amountVnd: PRICE - 1000, bankTime: t }));
    const queue = await listQueue();
    expect(queue.map((q) => q.reason).sort()).toEqual(["amount_short", "no_code"]);
    expect(queue.find((q) => q.reason === "amount_short")!.candidateOrderCode).toBe(s.code);
    expect(await orderNeedsManual(s.orderId, s.code)).toBe(true);
    await ingest(report({ content: s.code, bankTime: t }));
    expect((await listQueue()).map((q) => q.reason).sort()).toEqual(["amount_short", "no_code"]);
  });

  it("observation thiếu mã tham chiếu được giải quyết bằng dòng nhập tay", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    await ingest(report({ bankRef: null, content: s.code }));
    const [missing] = await listUnresolved();
    expect(missing).toMatchObject({ reason: "missing_ref" });
    await enterStatementLine(support, { ...line(s.code, new Date()), resolvesObservationId: missing!.observationId });
    expect(await listUnresolved()).toEqual([]);
  });
});

describe("route quản trị sổ giao dịch", () => {
  it("support nhập qua route, xem hàng chờ; chủ xác minh qua route", async () => {
    const { GET, POST } = await import("@/app/api/quan-tri/ledger/route");
    const { POST: verify } = await import("@/app/api/quan-tri/ledger/[id]/verify/route");
    const { adminSession, insertAdmin } = await import("../helpers/admin");
    const s = await paidCourseSetup();
    const supportSession = await adminSession(await insertAdmin("ht@x.vn", "support"));
    const ownerSession = await adminSession(await insertAdmin("chu@x.vn", "owner"));
    const call = (handler: (r: Request, ...a: never[]) => Promise<Response>, sess: { token: string; csrf: string }, method: string, path: string, body?: unknown, extra: unknown[] = []) =>
      (handler as (r: Request, ...a: unknown[]) => Promise<Response>)(
        new Request(`${process.env.APP_ORIGIN}${path}`, {
          method,
          headers: { cookie: `__Host-me_admin=${sess.token}`, origin: process.env.APP_ORIGIN!, "x-csrf-token": sess.csrf, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        ...extra,
      );
    const entered = await call(POST, supportSession, "POST", "/api/quan-tri/ledger", { ...line(s.code, new Date(s.createdAt.getTime() + 60_000)), bankTime: new Date(s.createdAt.getTime() + 60_000).toISOString() });
    expect([entered.status, await entered.json()]).toEqual([200, { outcome: "unverified" }]);
    const bad = await call(POST, supportSession, "POST", "/api/quan-tri/ledger", { bankCode: "VCB" });
    expect(bad.status).toBe(400);
    const { queue } = (await (await call(GET, supportSession, "GET", "/api/quan-tri/ledger")).json()) as { queue: { bankTransactionId: string }[] };
    expect(queue).toHaveLength(1);
    const id = queue[0]!.bankTransactionId;
    const res = await call(verify, ownerSession, "POST", `/api/quan-tri/ledger/${id}/verify`, { evidence: "đã xem sao kê" }, [{ params: Promise.resolve({ id }) }]);
    expect([res.status, await res.json()]).toEqual([200, { result: "verified", outcome: "confirmed" }]);
  });
});

describe("sửa sau review P2", () => {
  it("I-1: SePay báo cùng định danh, cùng tiền/giờ nhưng mã đơn trong nội dung khác dòng nhập tay → mismatch, không xác minh", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const t = new Date(s.createdAt.getTime() + 60_000);
    await enterStatementLine(support, line("MEAAAAAAAA", t, { bankRef: "FT-I1" }));
    expect(await ingest(report({ bankRef: "FT-I1", bankTime: t, content: `ck ${s.code}` }))).toBe("mismatch");
    expect(await prisma().bankTransactionVerification.count()).toBe(0);
    expect((await prisma().order.findUniqueOrThrow({ where: { id: s.orderId } })).status).toBe("pending");
  });

  it("I-1: nội dung khác chữ nhưng cùng mã đơn → vẫn khớp, provider_match", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    const t = new Date(s.createdAt.getTime() + 60_000);
    await enterStatementLine(support, line(s.code, t, { bankRef: "FT-I1B", content: `NGUYEN VAN A CK ${s.code}` }));
    expect(await ingest(report({ bankRef: "FT-I1B", bankTime: t, content: `ck ${s.code.toLowerCase()} cam on` }))).toBe("confirmed");
  });

  it("I-2: dòng nhập tay cho tài khoản khác tài khoản đã cấu hình → 400", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    await expect(enterStatementLine(support, line(s.code, new Date(), { bankCode: "VIETCOMBANK" }))).rejects.toMatchObject({ status: 400 });
    await expect(enterStatementLine(support, line(s.code, new Date(), { accountNo: "9999999999" }))).rejects.toMatchObject({ status: 400 });
  });

  it("I-4: giờ giao dịch nhập tay phải có múi giờ", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    await expect(enterStatementLine(support, line(s.code, new Date(), { bankTime: "2026-10-30T10:05:00" }))).rejects.toMatchObject({ status: 400 });
    expect(await enterStatementLine(support, line(s.code, new Date(), { bankTime: "2026-10-30T10:05:00+07:00" }))).toBe("unverified");
    const bt = await prisma().bankTransaction.findFirstOrThrow();
    expect(bt.bankTime.toISOString()).toBe("2026-10-30T03:05:00.000Z");
  });
});


describe("sửa sau Codex vòng 1", () => {
  it("#1: hỗ trợ xem hàng chờ không thấy nội dung chuyển khoản gốc và payload; chủ thấy", async () => {
    const { GET } = await import("@/app/api/quan-tri/ledger/route");
    const { adminSess, callAdmin } = await import("../helpers/admin-call");
    const s = await paidCourseSetup();
    await ingest(report({ content: `NGUYEN VAN A ck ${s.code} so tk 0123`, amountVnd: PRICE - 1 }));
    await ingest(report({ bankRef: null, content: "thieu ma tham chieu" }));
    const support = await adminSess("support");
    const owner = await adminSess("owner");
    const seen = async (who: typeof support) =>
      (await (await callAdmin(GET, who, "GET", "/api/quan-tri/ledger")).json()) as {
        queue: { content: string | null; candidateCodes: string[] }[];
        unresolved: { payload?: unknown }[];
      };
    const bySupport = await seen(support);
    expect(bySupport.queue[0]!.content).toBeNull();
    expect(bySupport.queue[0]!.candidateCodes).toEqual([s.code]);
    expect(bySupport.unresolved[0]!.payload).toBeUndefined();
    const byOwner = await seen(owner);
    expect(byOwner.queue[0]!.content).toContain("NGUYEN VAN A");
    expect(byOwner.unresolved[0]!.payload).toBeDefined();
  });

  it("#8: nhật ký nhập sao kê không chứa nội dung chuyển khoản", async () => {
    const s = await paidCourseSetup();
    const support = await adminCtx("support");
    await enterStatementLine(support, line(s.code, new Date(), { content: "NOI DUNG RIENG TU 123" }));
    const { sqlAsMigrator } = await import("../helpers/otp");
    const { rows } = await sqlAsMigrator(`SELECT after::text AS after FROM admin_audit_log WHERE action = 'ledger_enter'`);
    expect(rows[0].after).not.toContain("NOI DUNG RIENG TU");
    expect(rows[0].after).toContain("bankRef");
  });
});
