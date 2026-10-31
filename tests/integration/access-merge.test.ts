import { TEST_PAYOUT } from "../helpers/ledger";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { findUserIdByIdentity } from "@/modules/auth-learner/identities";
import { withTx } from "@/lib/db";
import { ingest } from "@/modules/ledger/ingest";
import { createOrder } from "@/modules/orders/orders";
import { advanceRefund, requestFullRefund } from "@/modules/refunds/refunds";
import { validateSession } from "@/modules/sessions/sessions";
import { GET as myCourses } from "@/app/api/me/courses/route";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { paidCourseSetup, report } from "../helpers/ledger";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";

async function setup() {
  const s = await paidCourseSetup();
  expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
  await prisma().userIdentity.create({ data: { userId: s.learner.userId, kind: "email", valueCanonical: "a@x.vn", verifiedAt: new Date() } });
  const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_tanker" } });
  const b = await testLearner("B");
  return { ...s, a: s.learner, b, courseId: course.id };
}

describe("gộp tài khoản", () => {
  it("xem trước không đổi gì; gộp A vào B: B có quyền khóa A đã mua, định danh chuyển sang B, phiên A null, audit", async () => {
    const s = await setup();
    const owner = await adminCtx("owner");
    const preview = await mergeAccounts(owner, { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "khách có hai tài khoản", preview: true });
    expect(preview).toEqual({ identities: [{ kind: "email", value: "a@x.vn" }], activeEnrollments: 1, orders: 1 });
    expect(await hasCourseAccess(s.b.userId, s.courseId)).toBe(false);
    expect(await mergeAccounts(owner, { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "khách có hai tài khoản", preview: false })).toBe("merged");
    expect(await hasCourseAccess(s.b.userId, s.courseId)).toBe(true);
    expect(await withTx((tx) => findUserIdByIdentity(tx, "email", "a@x.vn"))).toBe(s.b.userId);
    expect(await validateSession("learner", s.a.token)).toBeNull();
    expect(await prisma().device.count({ where: { userId: s.a.userId, revokedAt: null } })).toBe(0);
    expect(await prisma().enrollment.count({ where: { userId: s.a.userId } })).toBe(1);
    expect((await auditRows("account_merge")).map((r) => r.result)).toEqual(["ok"]);
  });

  it("sau khi gộp: B mua lại khóa → already_enrolled; hoàn đơn của A → B mất quyền", async () => {
    const s = await setup();
    const owner = await adminCtx("owner");
    await mergeAccounts(owner, { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "gộp", preview: false });
    expect(await createOrder(s.b, "engine_cadet_tanker")).toEqual({ kind: "already_enrolled" });
    const r = await requestFullRefund(owner, { orderCode: s.code, reason: "hoàn", payout: TEST_PAYOUT });
    if (!("refundId" in r)) throw new Error();
    await advanceRefund(owner, r.refundId, { action: "approve" });
    await advanceRefund(owner, r.refundId, { action: "send", outBankRef: "OUT-M", evidence: "x" });
    await advanceRefund(owner, r.refundId, { action: "confirm" });
    expect(await hasCourseAccess(s.b.userId, s.courseId)).toBe(false);
  });

  it("gộp vòng / gộp chính mình / tài khoản không tồn tại → invalid; support → 403; thiếu lý do → 400", async () => {
    const s = await setup();
    const owner = await adminCtx("owner");
    await mergeAccounts(owner, { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "gộp", preview: false });
    expect(await mergeAccounts(owner, { sourceUserId: s.b.userId, targetUserId: s.a.userId, reason: "x", preview: false })).toBe("invalid");
    expect(await mergeAccounts(owner, { sourceUserId: s.b.userId, targetUserId: s.b.userId, reason: "x", preview: false })).toBe("invalid");
    expect(await mergeAccounts(owner, { sourceUserId: crypto.randomUUID(), targetUserId: s.b.userId, reason: "x", preview: false })).toBe("invalid");
    expect(await rejected(mergeAccounts(await adminCtx("support"), { sourceUserId: s.b.userId, targetUserId: s.a.userId, reason: "x", preview: true }))).toBe("role");
    await expect(mergeAccounts(owner, { sourceUserId: s.b.userId, targetUserId: s.a.userId, reason: " ", preview: true })).rejects.toMatchObject({ status: 400 });
  });

  it("GET /api/me/courses liệt kê khóa và nguồn quyền theo nhóm gộp", async () => {
    const s = await setup();
    const owner = await adminCtx("owner");
    await mergeAccounts(owner, { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "gộp", preview: false });
    const res = await myCourses(learnerRequest("/api/me/courses", s.b));
    expect(await res.json()).toEqual({ courses: [{ slug: "engine_cadet_tanker", titleVi: expect.any(String), sources: ["order"] }] });
  });
});

describe("route gộp", () => {
  it("mặc định chỉ xem trước; preview=false thì gộp; tài khoản không hợp lệ → 409", async () => {
    const { POST } = await import("@/app/api/quan-tri/merges/route");
    const { adminSess, callAdmin } = await import("../helpers/admin-call");
    const s = await setup();
    const owner = await adminSess("owner");
    const body = { sourceUserId: s.a.userId, targetUserId: s.b.userId, reason: "khách xin gộp" };
    const preview = await callAdmin(POST, owner, "POST", "/api/quan-tri/merges", body);
    expect(await preview.json()).toMatchObject({ preview: { activeEnrollments: 1 } });
    expect((await prisma().user.findUniqueOrThrow({ where: { id: s.a.userId } })).status).toBe("active");
    expect(await (await callAdmin(POST, owner, "POST", "/api/quan-tri/merges", { ...body, preview: false })).json()).toEqual({ result: "merged" });
    expect((await callAdmin(POST, owner, "POST", "/api/quan-tri/merges", { ...body, preview: false })).status).toBe(409);
  });
});
