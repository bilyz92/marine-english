import { TEST_PAYOUT } from "../helpers/ledger";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { HttpError } from "@/lib/http";
import { POST as syncRoute } from "@/app/api/learn/sync/route";
import { verifyLicense } from "@/lib/offline/license-verify";
import { ingest } from "@/modules/ledger/ingest";
import { publicLicenseKeys } from "@/modules/learn/license";
import { syncEvents } from "@/modules/learn/sync";
import { advanceRefund, requestFullRefund } from "@/modules/refunds/refunds";
import { adminCtx } from "../helpers/admin-ctx";
import { paidCourseSetup, report } from "../helpers/ledger";
import { learnerRequest, testLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";
import { pgAs } from "../helpers/pg";

async function setup() {
  const s = await paidCourseSetup();
  expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
  const { rows } = await sqlAsMigrator(`SELECT l.external_id, l.id AS lesson_id, lv.id AS lv_id FROM lessons l JOIN lesson_versions lv ON lv.lesson_id = l.id`);
  const ids = Object.fromEntries(rows.map((r) => [r.external_id, { lessonId: r.lesson_id as string, lv: r.lv_id as string }]));
  const course = await prisma().course.findFirstOrThrow({ where: { slug: "engine_cadet_tanker" } });
  return { ...s, ids, courseId: course.id, l: s.learner };
}

const ev = (seq: number, lessonVersionId: string, type: string, payload: Record<string, unknown> = {}) => ({
  eventId: randomUUID(), seq, type, lessonVersionId, payload, clientTime: "2026-10-30T10:00:00+07:00",
});
const statuses = (r: { results: { status: string }[] }) => r.results.map((x) => x.status);
const progress = (userId: string, lessonId: string) =>
  prisma().learningProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } });

async function refund(code: string) {
  const owner = await adminCtx("owner");
  const r = await requestFullRefund(owner, { orderCode: code, reason: "hoàn", payout: TEST_PAYOUT });
  if (!("refundId" in r)) throw new Error();
  await advanceRefund(owner, r.refundId, { action: "approve" });
  await advanceRefund(owner, r.refundId, { action: "send", outBankRef: `OUT-${code}`, evidence: "x" });
  await advanceRefund(owner, r.refundId, { action: "confirm" });
}

describe("đồng bộ sự kiện", () => {
  it("lô hợp lệ → accepted, tiến độ cập nhật; gửi lại cả lô → duplicate, không dòng mới", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    const events = [ev(1, t.lv, "lesson_opened"), ev(2, t.lv, "activity_completed", { activityId: "a1" }), ev(3, t.lv, "lesson_completed", { scorePct: 90 })];
    const r = await syncEvents(s.l, { events });
    expect(statuses(r)).toEqual(["accepted", "accepted", "accepted"]);
    expect(await progress(s.l.userId, t.lessonId)).toMatchObject({ status: "completed", completedActivities: ["a1"], bestScorePct: 90 });
    const again = await syncEvents(s.l, { events });
    expect(statuses(again)).toEqual(["duplicate", "duplicate", "duplicate"]);
    expect(await prisma().learningEvent.count()).toBe(3);
    const row = await prisma().learningEvent.findFirstOrThrow({ where: { seq: 1 } });
    expect(row).toMatchObject({ deviceId: s.l.deviceId, courseId: s.courseId, entitlementOk: true });
  });

  it("cùng eventId khác nội dung; seq đã dùng; bài không tồn tại; sai định dạng → rejected + sync_rejections, không hủy cả lô", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    const first = ev(1, t.lv, "lesson_opened");
    await syncEvents(s.l, { events: [first] });
    const r = await syncEvents(s.l, {
      events: [
        { ...first, payload: { khac: true } },
        ev(1, t.lv, "lesson_opened"),
        ev(2, randomUUID(), "lesson_opened"),
        { eventId: "khong-phai-uuid", seq: 3, type: "lesson_opened", lessonVersionId: t.lv, payload: {} },
        ev(4, t.lv, "kieu_la"),
        ev(5, t.lv, "quiz_attempt", { scorePct: 101 }),
        ev(6, t.lv, "activity_completed", { scorePct: 1 }),
        ev(7, t.lv, "activity_completed", { activityId: "a2" }),
      ],
    });
    expect(statuses(r)).toEqual(["rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "rejected", "accepted"]);
    expect(r.results[0]!.reason).toBe("event_id_conflict");
    expect(r.results[1]!.reason).toBe("seq_conflict");
    expect(r.results[2]!.reason).toBe("lesson_not_found");
    expect(await prisma().syncRejection.count()).toBe(7);
  });

  it("sự kiện của tài khoản khác dùng trùng eventId → rejected, không lộ/ghi đè", async () => {
    const s = await setup();
    const first = ev(1, s.ids.T001!.lv, "lesson_opened");
    await syncEvents(s.l, { events: [first] });
    const { testLearner } = await import("../helpers/learner-ctx");
    const other = await testLearner("B");
    const r = await syncEvents(other, { events: [first] });
    expect(r.results[0]).toMatchObject({ status: "rejected", reason: "event_id_conflict" });
  });

  it("khóa đã hoàn tiền: sự kiện accepted với entitlement_ok=false, tiến độ không đổi, revokedCourseIds có khóa, giấy phép không có khóa", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    await refund(s.code);
    const r = await syncEvents(s.l, { events: [ev(1, t.lv, "lesson_completed", { scorePct: 50 })], knownCourseIds: [s.courseId] });
    expect(statuses(r)).toEqual(["accepted"]);
    expect((await prisma().learningEvent.findFirstOrThrow()).entitlementOk).toBe(false);
    expect(await progress(s.l.userId, t.lessonId)).toBeNull();
    expect(r.revokedCourseIds).toEqual([s.courseId]);
    const claims = await verifyLicense(r.license, publicLicenseKeys());
    expect(claims!.courses).toEqual([]);
  });

  it("điểm 80 rồi 60 → best 80, 2 lần làm; tiến độ không lùi khi sự kiện cũ đến sau", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    await syncEvents(s.l, { events: [ev(1, t.lv, "quiz_attempt", { scorePct: 80 }), ev(2, t.lv, "quiz_attempt", { scorePct: 60 }), ev(3, t.lv, "lesson_completed")] });
    await syncEvents(s.l, { events: [ev(4, t.lv, "lesson_opened")] });
    expect(await progress(s.l.userId, t.lessonId)).toMatchObject({ status: "completed", bestScorePct: 80 });
    expect((await prisma().quizAttempt.findMany({ orderBy: { scorePct: "desc" } })).map((q) => q.scorePct)).toEqual([80, 60]);
  });

  it("giấy phép xác minh được, chỉ chứa khóa có quyền đúng thiết bị; trustedKids được tôn trọng", async () => {
    const s = await setup();
    const r = await syncEvents(s.l, { events: [], trustedKids: ["l1"] });
    expect(JSON.parse(Buffer.from(r.license.split(".")[0]!, "base64url").toString()).kid).toBe("l1");
    const claims = await verifyLicense(r.license, publicLicenseKeys());
    expect(claims).toMatchObject({ sub: s.l.userId, did: s.l.deviceId, courses: [{ id: s.courseId }] });
    expect(r.courses.map((c) => c.slug)).toEqual(["engine_cadet_tanker"]);
    expect(r.revokedCourseIds).toEqual([]);
  });

  it("201 sự kiện → 400; 200 sự kiện chạy được", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    const many = (n: number) => Array.from({ length: n }, (_, i) => ev(i + 1, t.lv, "activity_completed", { activityId: `a${i}` }));
    await expect(syncEvents(s.l, { events: many(201) })).rejects.toMatchObject({ status: 400 });
    expect(statuses(await syncEvents(s.l, { events: many(200) })).every((x) => x === "accepted")).toBe(true);
    expect((await progress(s.l.userId, t.lessonId))!.completedActivities).toHaveLength(200);
  });

  it("hai lô song song cùng thiết bị → không lỗi, mỗi sự kiện đúng một kết quả", async () => {
    const s = await setup();
    const t = s.ids.T001!;
    const a = [ev(1, t.lv, "activity_completed", { activityId: "a1" }), ev(2, t.lv, "activity_completed", { activityId: "a2" })];
    const b = [ev(3, t.lv, "activity_completed", { activityId: "a3" }), a[0]!];
    const [ra, rb] = await Promise.all([syncEvents(s.l, { events: a }), syncEvents(s.l, { events: b })]);
    expect([...statuses(ra), ...statuses(rb)].every((x) => x === "accepted" || x === "duplicate")).toBe(true);
    expect(await prisma().learningEvent.count()).toBe(3);
    expect((await progress(s.l.userId, t.lessonId))!.completedActivities.sort()).toEqual(["a1", "a2", "a3"]);
  });
});

describe("route đồng bộ", () => {
  const call = (s: Awaited<ReturnType<typeof setup>>, body: unknown) => syncRoute(learnerRequest("/api/learn/sync", s.l, { method: "POST", body }));

  it("trả kết quả + giấy phép; thiếu CSRF → 403; body quá 256 KB → 413; không phải mảng → 400", async () => {
    const s = await setup();
    const res = await call(s, { events: [ev(1, s.ids.T001!.lv, "lesson_opened")] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: unknown[]; license: string };
    expect(body.results).toHaveLength(1);
    expect(body.license.split(".")).toHaveLength(3);
    const noCsrf = learnerRequest("/api/learn/sync", s.l, { method: "POST", body: { events: [] } });
    noCsrf.headers.delete("x-csrf-token");
    expect((await syncRoute(noCsrf)).status).toBe(403);
    expect((await call(s, { events: [{ pad: "x".repeat(300_000) }] })).status).toBe(413);
    expect((await call(s, { events: "rác" })).status).toBe(400);
  });

  it("token ≥ 7 ngày → cookie phiên mới trong phản hồi; chưa tới hạn → không cookie", async () => {
    const s = await setup();
    const fresh = await call(s, { events: [] });
    expect(fresh.headers.getSetCookie()).toEqual([]);
    await sqlAsMigrator(`UPDATE learner_sessions SET token_issued_at = token_issued_at - interval '7 days' WHERE id = $1`, [s.l.sessionId]);
    const rotated = await call(s, { events: [] });
    expect(rotated.headers.getSetCookie().some((c) => c.startsWith("__Host-me_learn="))).toBe(true);
    expect(rotated.headers.getSetCookie().some((c) => c.startsWith("__Host-me_csrf_learner="))).toBe(true);
  });
});

describe("manifest có tiến độ", () => {
  it("bài đã học hiện trạng thái và hoạt động đã xong", async () => {
    const { GET } = await import("@/app/api/learn/courses/[slug]/manifest/route");
    const s = await setup();
    await syncEvents(s.l, { events: [ev(1, s.ids.T001!.lv, "activity_completed", { activityId: "a1" }), ev(2, s.ids.A001!.lv, "lesson_completed")] });
    const res = await GET(learnerRequest("/api/learn/courses/engine_cadet_tanker/manifest", s.l), { params: Promise.resolve({ slug: "engine_cadet_tanker" }) });
    const m = (await res.json()) as { lessons: { externalId: string; status: string | null; completedActivities: string[] }[] };
    expect(m.lessons.find((l) => l.externalId === "T001")).toMatchObject({ status: "in_progress", completedActivities: ["a1"] });
    expect(m.lessons.find((l) => l.externalId === "A001")).toMatchObject({ status: "completed" });
    expect(m.lessons.find((l) => l.externalId === "A002")).toMatchObject({ status: null, completedActivities: [] });
  });
});

describe("nhiều thiết bị đồng bộ cùng lúc", () => {
  it("15 học viên đồng bộ song song không treo vì cạn kết nối", async () => {
    const s = await setup();
    const { testLearner } = await import("../helpers/learner-ctx");
    const learners = await Promise.all(Array.from({ length: 15 }, (_, i) => testLearner(`L${i}`)));
    const started = Date.now();
    const results = await Promise.all(
      learners.map((l) => syncEvents(l, { events: [ev(1, s.ids.A001!.lv, "lesson_opened"), ev(2, s.ids.A001!.lv, "lesson_completed")] })),
    );
    expect(results.flatMap(statuses).every((x) => x === "accepted")).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);
});

describe("hết kết nối tạm thời", () => {
  it("cả pool bận 3 giây → đồng bộ xếp hàng chờ rồi thành công, không báo lỗi", async () => {
    const l = await testLearner("Xep hang");
    const busy = Array.from({ length: 10 }, () =>
      prisma().$transaction(() => new Promise((r) => setTimeout(r, 3000)), { timeout: 10_000, maxWait: 10_000 }),
    );
    await new Promise((r) => setTimeout(r, 200));
    const result = await syncEvents(l, { events: [] });
    expect(result.results).toEqual([]);
    await Promise.all(busy);
  }, 30_000);
});

describe("đồng bộ kiểm lại người, máy, phiên (Codex P3 #4)", () => {
  it("tài khoản đã gộp, thiết bị đã gỡ hoặc phiên đã thu hồi → 401, không lưu sự kiện", async () => {
    const s = await setup();
    const { testLearner } = await import("../helpers/learner-ctx");
    const { mergeAccounts } = await import("@/modules/enrollments/merge");
    const target = await testLearner("Đích");
    await mergeAccounts(await adminCtx("owner"), { sourceUserId: s.l.userId, targetUserId: target.userId, reason: "gộp", preview: false });
    await expect(syncEvents(s.l, { events: [ev(1, s.ids.T001!.lv, "lesson_opened")] })).rejects.toMatchObject({ status: 401 });
    const other = await testLearner("Khác");
    await prisma().device.update({ where: { id: other.deviceId }, data: { revokedAt: new Date() } });
    await expect(syncEvents(other, { events: [] })).rejects.toMatchObject({ status: 401 });
    const third = await testLearner("Ba");
    await prisma().learnerSession.update({ where: { id: third.sessionId }, data: { revokedAt: new Date() } });
    await expect(syncEvents(third, { events: [] })).rejects.toMatchObject({ status: 401 });
    expect(await prisma().learningEvent.count()).toBe(0);
  });
});


describe("giấy phép cấp trong lúc còn giữ khóa (Codex P3 vòng 3)", () => {
  it("gỡ máy chạy song song với đồng bộ lô lớn: nếu đồng bộ nhận giấy phép thì lệnh gỡ phải xong sau đó", async () => {
    const s = await setup();
    const { adminRemoveDevice } = await import("@/modules/learn/devices");
    const events = Array.from({ length: 150 }, (_, i) => ev(i + 1, s.ids.T001!.lv, "activity_completed", { activityId: `a${i}` }));
    let syncDoneAt = 0;
    let removedAt = 0;
    const sync = syncEvents(s.l, { events }).then(
      (r) => { syncDoneAt = performance.now(); return r; },
      (e: unknown) => { syncDoneAt = performance.now(); return e; },
    );
    await new Promise((r) => setTimeout(r, 150));
    await adminRemoveDevice(await adminCtx("support"), s.l.deviceId, "mất máy").then(() => { removedAt = performance.now(); });
    const result = await sync;
    if (result && typeof result === "object" && "license" in result) {
      expect(removedAt).toBeGreaterThanOrEqual(syncDoneAt);
    } else {
      expect(result).toMatchObject({ status: 401 });
    }
  }, 60_000);
});

describe("đăng xuất chạy song song với đồng bộ", () => {
  it("đăng xuất đang giữ khóa phiên → đồng bộ chờ rồi trả 401, không cấp giấy phép", async () => {
    const l = await testLearner("Dang xuat");
    const pg = await pgAs("app");
    try {
      await pg.query("BEGIN");
      await pg.query(`UPDATE learner_sessions SET revoked_at = now() WHERE id = $1`, [l.sessionId]);
      const sync = syncEvents(l, { events: [] }).then(() => "ok", (e: HttpError) => e.status);
      await new Promise((r) => setTimeout(r, 300));
      await pg.query("COMMIT");
      expect(await sync).toBe(401);
    } finally {
      await pg.end();
    }
  });
});

