import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { adminRemoveDevice, listMyDevices, removeMyDevice } from "@/modules/learn/devices";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { syncEvents } from "@/modules/learn/sync";
import { createSession, validateSession } from "@/modules/sessions/sessions";
import { GET, DELETE } from "@/app/api/me/devices/route";
import { auditRows } from "../helpers/admin";
import { adminCtx } from "../helpers/admin-ctx";
import { newDeviceKey } from "../helpers/learner";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { paidCourseSetup, report } from "../helpers/ledger";
import { ingest } from "@/modules/ledger/ingest";
import { randomUUID } from "node:crypto";
import { sqlAsMigrator } from "../helpers/otp";

const MIN = 60_000;

async function secondDevice(l: TestLearner) {
  const device = await prisma().device.create({ data: { userId: l.userId, deviceKeyHash: newDeviceKey(), label: "Máy hai" } });
  const s = await withTx((tx) => createSession(tx, { realm: "learner", userId: l.userId, deviceId: device.id, authAt: new Date() }));
  return { deviceId: device.id, token: s.token };
}

describe("thiết bị của tôi", () => {
  it("liệt kê đúng máy còn hoạt động của mình, đánh dấu máy đang dùng", async () => {
    const a = await testLearner("A");
    await testLearner("B");
    const second = await secondDevice(a);
    const list = await listMyDevices(a);
    expect(list.map((d) => [d.id, d.current]).sort()).toEqual([[a.deviceId, true], [second.deviceId, false]].sort());
  });

  it("gỡ máy khác → phiên máy đó null; máy người khác → not_found; xác thực cũ → reauth_required", async () => {
    const a = await testLearner("A");
    const b = await testLearner("B");
    const second = await secondDevice(a);
    expect(await removeMyDevice({ ...a, authAt: new Date(Date.now() - 10 * MIN) }, second.deviceId)).toBe("reauth_required");
    expect(await removeMyDevice(a, b.deviceId)).toBe("not_found");
    expect(await removeMyDevice(a, second.deviceId)).toBe("removed");
    expect(await validateSession("learner", second.token)).toBeNull();
    expect(await validateSession("learner", a.token)).not.toBeNull();
    expect(await removeMyDevice(a, second.deviceId)).toBe("not_found");
  });

  it("route: GET, DELETE; gỡ chính máy đang dùng thì xóa cookie phiên", async () => {
    const a = await testLearner("A");
    const res = await GET(learnerRequest("/api/me/devices", a));
    expect(((await res.json()) as { devices: unknown[] }).devices).toHaveLength(1);
    expect((await DELETE(learnerRequest("/api/me/devices?id=rac", a, { method: "DELETE" }))).status).toBe(400);
    const del = await DELETE(learnerRequest(`/api/me/devices?id=${a.deviceId}`, a, { method: "DELETE" }));
    expect(del.status).toBe(200);
    expect(del.headers.getSetCookie().find((c) => c.startsWith("__Host-me_learn="))).toContain("Max-Age=0");
    expect(await validateSession("learner", a.token)).toBeNull();
  });

  it("hỗ trợ gỡ hộ có nhật ký và lý do", async () => {
    const a = await testLearner("A");
    const support = await adminCtx("support");
    expect(await adminRemoveDevice(support, a.deviceId, "khách mất máy")).toBe("removed");
    expect(await validateSession("learner", a.token)).toBeNull();
    expect(await auditRows("device_remove")).toMatchObject([{ result: "ok", reason: "khách mất máy", target_id: a.deviceId }]);
    expect(await adminRemoveDevice(support, a.deviceId, "lần hai")).toBe("not_found");
    await expect(adminRemoveDevice(support, a.deviceId, " ")).rejects.toMatchObject({ status: 400 });
  });
});

describe("gộp tài khoản chép tiến độ", () => {
  it("A (bài 1 completed 90%) gộp vào B (bài 1 in_progress 50%, hoạt động khác) → B completed 90%, hợp hoạt động", async () => {
    const s = await paidCourseSetup();
    expect(await ingest(report({ content: s.code, bankTime: new Date(s.createdAt.getTime() + 60_000) }))).toBe("confirmed");
    const { rows: [t] } = await sqlAsMigrator(`SELECT l.id, lv.id AS lv FROM lessons l JOIN lesson_versions lv ON lv.lesson_id = l.id WHERE l.external_id = 'A001'`);
    const { rows: [t2] } = await sqlAsMigrator(`SELECT l.id, lv.id AS lv FROM lessons l JOIN lesson_versions lv ON lv.lesson_id = l.id WHERE l.external_id = 'A002'`);
    const b = await testLearner("B");
    const ev = (seq: number, lv: string, type: string, payload: object) => ({ eventId: randomUUID(), seq, type, lessonVersionId: lv, payload });
    await syncEvents(s.learner, { events: [ev(1, t.lv, "activity_completed", { activityId: "x" }), ev(2, t.lv, "lesson_completed", { scorePct: 90 }), ev(3, t2.lv, "lesson_opened", {})] });
    await syncEvents(b, { events: [ev(1, t.lv, "activity_completed", { activityId: "y" }), ev(2, t.lv, "quiz_attempt", { scorePct: 50 })] });
    await mergeAccounts(await adminCtx("owner"), { sourceUserId: s.learner.userId, targetUserId: b.userId, reason: "gộp", preview: false });
    const p = await prisma().learningProgress.findUniqueOrThrow({ where: { userId_lessonId: { userId: b.userId, lessonId: t.id } } });
    expect(p).toMatchObject({ status: "completed", bestScorePct: 90 });
    expect([...p.completedActivities].sort()).toEqual(["x", "y"]);
    expect(await prisma().learningProgress.findUnique({ where: { userId_lessonId: { userId: b.userId, lessonId: t2.id } } })).toMatchObject({ status: "in_progress" });
    expect(await prisma().learningProgress.count({ where: { userId: s.learner.userId } })).toBe(2);
  });
});

describe("gỡ hộ đồng thời (Codex P3 #7)", () => {
  it("hai quản trị cùng gỡ một máy → một removed, một not_found", async () => {
    const a = await testLearner("A");
    const [s1, s2] = [await adminCtx("support"), await adminCtx("support")];
    const results = await Promise.all([adminRemoveDevice(s1, a.deviceId, "mất máy"), adminRemoveDevice(s2, a.deviceId, "mất máy")]);
    expect(results.sort()).toEqual(["not_found", "removed"]);
  });
});
