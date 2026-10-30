import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hasCourseAccess } from "@/modules/enrollments/access";
import { grantCourse, revokeGrant } from "@/modules/enrollments/grants";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { seedContent } from "../helpers/content";
import { testLearner } from "../helpers/learner-ctx";

describe("cấp không thu tiền", () => {
  it("owner cấp → quyền học nguồn grant, không có đơn; thu hồi → mất quyền; có audit", async () => {
    const ids = await seedContent();
    const owner = await adminCtx("owner");
    const l = await testLearner();
    const courseId = ids.engine_cadet_tanker!;
    const r = await grantCourse(owner, { userId: l.userId, courseId, reason: "học thử nội bộ" });
    expect(r).toMatchObject({ result: "granted" });
    expect(await hasCourseAccess(l.userId, courseId)).toBe(true);
    expect(await prisma().order.count()).toBe(0);
    if (r.result !== "granted") throw new Error();
    expect(await revokeGrant(owner, r.enrollmentId, "hết thời gian thử")).toBe("revoked");
    expect(await hasCourseAccess(l.userId, courseId)).toBe(false);
    expect(await revokeGrant(owner, r.enrollmentId, "lần hai")).toBe("not_found");
    expect((await auditRows()).map((a) => a.action)).toEqual(["grant_create", "grant_revoke"]);
  });

  it("thiếu lý do → 400; user/khóa không tồn tại → not_found; support → 403; owner lâu chưa xác thực → 403", async () => {
    const ids = await seedContent();
    const owner = await adminCtx("owner");
    const l = await testLearner();
    await expect(grantCourse(owner, { userId: l.userId, courseId: ids.engine_cadet_tanker!, reason: "  " })).rejects.toMatchObject({ status: 400 });
    expect(await grantCourse(owner, { userId: crypto.randomUUID(), courseId: ids.engine_cadet_tanker!, reason: "x" })).toEqual({ result: "not_found" });
    expect(await rejected(grantCourse(await adminCtx("support"), { userId: l.userId, courseId: ids.engine_cadet_tanker!, reason: "x" }))).toBe("role");
    const stale = await adminCtx("owner", new Date(Date.now() - 11 * 60_000));
    expect(await rejected(grantCourse(stale, { userId: l.userId, courseId: ids.engine_cadet_tanker!, reason: "x" }))).toBe("reauth_required");
  });
});
