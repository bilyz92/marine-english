import { describe, expect, it } from "vitest";
import { POST as bulkStatus } from "@/app/api/quan-tri/courses/bulk-status/route";
import { withTx } from "@/lib/db";
import { createSession } from "@/modules/sessions/sessions";
import { auditRows, insertAdmin } from "../helpers/admin";
import { adminSess, callAdmin, type AdminSess } from "../helpers/admin-call";
import { sqlAsMigrator } from "../helpers/otp";
import { publish, seedContent } from "../helpers/content";

// Ngừng bán / mở bán tất cả (chủ 24/11/2026): nháp không bao giờ bị đụng; mỗi khóa đổi có một dòng audit course_update.
const T = "engine_cadet_tanker";
const D = "engine_cadet_dry_cargo";

async function statuses(): Promise<Record<string, string>> {
  const { rows } = await sqlAsMigrator(`SELECT slug, status FROM courses`);
  return Object.fromEntries(rows.map((r) => [r.slug, r.status]));
}
const call = (s: AdminSess, body: unknown) => callAdmin(bulkStatus, s, "POST", "/api/quan-tri/courses/bulk-status", body);

describe("đổi trạng thái hàng loạt", () => {
  it("ngừng bán tất cả: chỉ khóa đang bán thành archived, nháp giữ nguyên, có audit từng khóa", async () => {
    const ids = await seedContent();
    await publish(T);
    const owner = await adminSess("owner");
    const res = await call(owner, { status: "archived" });
    expect([res.status, await res.json()]).toEqual([200, { changed: 1, skipped: 0 }]);
    expect(await statuses()).toEqual({ [T]: "archived", [D]: "draft" });
    const rows = await auditRows("course_update");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ admin_user_id: owner.adminId, target_id: ids[T], result: "ok", reason: "bulk" });
    const { rows: [detail] } = await sqlAsMigrator(`SELECT before, after FROM admin_audit_log WHERE action = 'course_update'`);
    expect(detail).toEqual({ before: { priceVnd: 199_000, status: "published" }, after: { priceVnd: 199_000, status: "archived" } });
  });

  it("mở bán tất cả: chỉ khóa đã ngừng bán có giá và có bài; bỏ qua khóa thiếu giá hoặc chưa có bài, nháp giữ nguyên", async () => {
    const ids = await seedContent();
    await publish(T);
    await sqlAsMigrator(`UPDATE courses SET status = 'archived' WHERE slug = $1`, [T]);
    await sqlAsMigrator(`UPDATE courses SET status = 'archived', price_vnd = NULL WHERE slug = $1`, [D]);
    await sqlAsMigrator(`INSERT INTO courses (slug, title_vi, title_en, status, price_vnd, url_slug) VALUES ('khong_bai', 'Chưa có bài', 'No lessons', 'archived', 99000, 'chua-co-bai')`);
    await sqlAsMigrator(`INSERT INTO courses (slug, title_vi, title_en, url_slug) VALUES ('nhap_moi', 'Nháp', 'Draft', 'nhap')`);
    await sqlAsMigrator(`UPDATE courses SET price_vnd = 99000 WHERE slug = 'nhap_moi'`);
    const owner = await adminSess("owner");
    const res = await call(owner, { status: "published" });
    expect([res.status, await res.json()]).toEqual([200, { changed: 1, skipped: 2 }]);
    expect(await statuses()).toEqual({ [T]: "published", [D]: "archived", khong_bai: "archived", nhap_moi: "draft" });
    const rows = await auditRows("course_update");
    expect(rows.map((r) => [r.target_id, r.reason])).toEqual([[ids[T], "bulk"]]);
  });

  it("không có khóa nào để đổi → 0 khóa, không audit", async () => {
    await seedContent();
    const res = await call(await adminSess("owner"), { status: "published" });
    expect(await res.json()).toEqual({ changed: 0, skipped: 0 });
    expect(await auditRows("course_update")).toHaveLength(0);
  });

  it("hỗ trợ → 403 role, không đổi gì; trạng thái khác archived/published → 400", async () => {
    await seedContent();
    await publish(T);
    const support = await adminSess("support");
    const res = await call(support, { status: "archived" });
    expect([res.status, await res.json()]).toEqual([403, { error: "role" }]);
    expect((await statuses())[T]).toBe("published");
    expect((await auditRows("course_update")).map((r) => [r.admin_user_id, r.result, r.reason])).toEqual([[support.adminId, "denied", "role"]]);
    const owner = await adminSess("owner");
    expect((await call(owner, { status: "draft" })).status).toBe(400);
    expect((await call(owner, {})).status).toBe(400);
    const staleId = await insertAdmin("cu@x.vn", "owner");
    const stale = { adminId: staleId, ...(await withTx((tx) => createSession(tx, { realm: "admin", adminId: staleId, authAt: new Date(Date.now() - 11 * 60_000) }))) };
    const old = await call(stale, { status: "archived" });
    expect([old.status, await old.json()]).toEqual([403, { error: "reauth_required" }]);
    expect((await statuses())[T]).toBe("published");
  });
});
