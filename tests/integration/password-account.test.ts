import { describe, expect, it } from "vitest";
import { prisma, withTx } from "@/lib/db";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { POST as myPassword } from "@/app/api/me/password/route";
import { createUserWithIdentity } from "@/modules/auth-learner/identities";
import { issueOtp } from "@/modules/auth-learner/otp";
import { adminResetPassword, registerWithPassword } from "@/modules/auth-learner/password";
import { searchLearners } from "@/modules/admin/learners";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { createSession } from "@/modules/sessions/sessions";
import { auditRows } from "../helpers/admin";
import { adminCtx, rejected } from "../helpers/admin-ctx";
import { newDeviceKey, ORIGIN } from "../helpers/learner";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

// D2 Task 4: đổi / thêm mật khẩu ở Tài khoản của tôi, chủ đặt mật khẩu tạm (G15), tìm theo số, gộp tài khoản.

const PW = "Thuyenvien2026";
const NEW_PW = "Mat khau moi 2026";
const DEVICE = newDeviceKey();
let ipSeq = 0;

/** Học viên có số + mật khẩu và một phiên (TestLearner) để gọi route của chính mình. */
async function phoneLearner(phone = "0912345678", authAt = new Date()): Promise<TestLearner> {
  const created = await registerWithPassword({ phone, password: PW, displayName: "Học viên", rank: null, ip: `10.7.0.${++ipSeq}` }, async (tx, userId) => {
    const [device] = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO devices (user_id, device_key_hash, label) VALUES (${userId}::uuid, ${newDeviceKey()}, 'đt') RETURNING id`;
    const s = await createSession(tx, { realm: "learner", userId, deviceId: device!.id, authAt });
    return { userId, deviceId: device!.id, sessionId: s.sessionId, authAt, ip: "10.7.9.9", token: s.token, csrf: s.csrf };
  });
  if (created.kind !== "ok") throw new Error(created.kind);
  return created.value;
}

async function change(l: TestLearner, body: Record<string, unknown>) {
  const res = await myPassword(learnerRequest("/api/me/password", l, { method: "POST", body }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function login(phone: string, password: string) {
  const res = await loginRoute(new Request(`${ORIGIN}/api/auth/learner/password/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.7.1.${++ipSeq % 250}` },
    body: JSON.stringify({ phone, password, deviceKey: DEVICE, deviceLabel: "Điện thoại" }),
  }));
  return ((await res.json()) as { next: string }).next;
}

const liveSessions = async (userId: string) =>
  (await sqlAsMigrator(`SELECT id FROM learner_sessions WHERE user_id = $1 AND revoked_at IS NULL`, [userId])).rows.map((r) => r.id as string);

async function issueReset(userId: string, email: string): Promise<void> {
  await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', $2, now())`, [userId, email]);
  await issueOtp({ purpose: "reset", kind: "email", value: email, ip: "10.7.8.8", userId, create: true }, { send: async () => {} });
}

const liveResetCodes = async (userId: string) =>
  (await sqlAsMigrator(`SELECT count(*)::int AS n FROM otp_challenges WHERE user_id = $1 AND purpose = 'reset' AND consumed_at IS NULL AND invalidated_at IS NULL`, [userId])).rows[0].n as number;

describe("Tài khoản của tôi: đổi mật khẩu", () => {
  it("cần mật khẩu hiện tại; đổi xong: phiên khác, vé thay máy và mã đặt lại bị hủy, phiên đang dùng giữ", async () => {
    const l = await phoneLearner();
    expect(await login("0912345678", PW)).toBe("done");
    await issueReset(l.userId, "a@x.vn");
    expect(await change(l, { currentPassword: "sai roi nhe", newPassword: NEW_PW })).toEqual({ status: 400, body: { error: "invalid_current" } });
    expect(await change(l, { newPassword: NEW_PW })).toEqual({ status: 400, body: { error: "invalid_current" } });
    expect(await change(l, { currentPassword: PW, newPassword: "1234" })).toEqual({ status: 400, body: { error: "weak_password", problem: "too_short" } });
    expect(await change(l, { currentPassword: PW, newPassword: NEW_PW })).toEqual({ status: 200, body: { ok: true } });
    expect(await liveSessions(l.userId)).toEqual([l.sessionId]);
    expect(await liveResetCodes(l.userId)).toBe(0);
    expect(await login("0912345678", PW)).toBe("invalid");
    expect(await login("0912345678", NEW_PW)).toBe("done");
  });

  it("sai mật khẩu hiện tại 5 lần → khóa chung với đăng nhập", async () => {
    const l = await phoneLearner();
    for (let i = 0; i < 5; i++) await change(l, { currentPassword: `sai lan ${i} roi`, newPassword: NEW_PW });
    expect(await change(l, { currentPassword: PW, newPassword: NEW_PW })).toEqual({ status: 429, body: { error: "locked" } });
    expect(await login("0912345678", PW)).toBe("locked");
  });
});

describe("Tài khoản của tôi: thêm số + mật khẩu (tài khoản email/Google)", () => {
  it("cần đăng nhập gần đây và số; thêm xong đăng nhập được bằng số", async () => {
    const old = await testLearner("Email cũ");
    old.authAt = new Date(Date.now() - 3_600_000);
    await sqlAsMigrator(`UPDATE learner_sessions SET auth_at = now() - interval '1 hour' WHERE id = $1`, [old.sessionId]);
    expect((await change(old, { phone: "0912345678", newPassword: NEW_PW })).body).toEqual({ error: "reauth_required" });
    const l = await testLearner("Email");
    expect((await change(l, { newPassword: NEW_PW })).body).toEqual({ error: "phone_required" });
    expect((await change(l, { phone: "123", newPassword: NEW_PW })).body).toEqual({ error: "invalid_phone" });
    expect(await change(l, { phone: "0912345678", newPassword: NEW_PW })).toEqual({ status: 200, body: { ok: true } });
    expect(await login("0912345678", NEW_PW)).toBe("done");
  });

  it("số đã xác minh của người khác → phone_taken; số đã xác minh của chính mình → được, ghi đã xác minh", async () => {
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84987654321", displayName: "Khác", rank: null }));
    const l = await testLearner("Email");
    expect((await change(l, { phone: "0987654321", newPassword: NEW_PW })).body).toEqual({ error: "phone_taken" });
    await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'phone', '+84912345678', now())`, [l.userId]);
    expect((await change(l, { phone: "0912345678", newPassword: NEW_PW })).body).toEqual({ ok: true });
    expect((await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: l.userId } })).phoneVerifiedAt).not.toBeNull();
  });

  it("dòng đã bị nhả → học viên vào bằng email rồi tự gắn số mới", async () => {
    const l = await phoneLearner();
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84912345678", displayName: "Chủ số", rank: null }));
    expect(await login("0912345678", PW)).toBe("invalid");
    expect((await change(l, { phone: "0933333333", newPassword: NEW_PW })).body).toEqual({ ok: true });
    expect(await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: l.userId } })).toMatchObject({ phoneCanonical: "+84933333333", releasedAt: null });
    expect(await login("0933333333", NEW_PW)).toBe("done");
  });
});

describe("chủ đặt mật khẩu tạm (G15)", () => {
  it("hỗ trợ → role; chủ chưa xác thực lại → reauth_required; thiếu lý do hay bằng chứng → 400", async () => {
    const l = await phoneLearner();
    const input = { reason: "khách mất mật khẩu", evidence: "mã đơn MEAAAAAAAB, giao dịch FT123" };
    expect(await rejected(adminResetPassword(await adminCtx("support"), l.userId, input))).toBe("role");
    expect(await rejected(adminResetPassword(await adminCtx("owner", new Date(Date.now() - 3_600_000)), l.userId, input))).toBe("reauth_required");
    const owner = await adminCtx("owner");
    await expect(adminResetPassword(owner, l.userId, { ...input, reason: " " })).rejects.toMatchObject({ status: 400 });
    await expect(adminResetPassword(owner, l.userId, { ...input, evidence: "" })).rejects.toMatchObject({ status: 400 });
  });

  it("chủ đặt: trả mật khẩu tạm một lần, phải đổi khi đăng nhập, phiên và mã đặt lại bị hủy, nhật ký không có mật khẩu", async () => {
    const l = await phoneLearner();
    await issueReset(l.userId, "a@x.vn");
    const owner = await adminCtx("owner");
    const r = await adminResetPassword(owner, l.userId, { reason: "khách mất mật khẩu", evidence: "mã đơn MEAAAAAAAB" });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(r.temporaryPassword).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{10}$/);
    expect(await liveSessions(l.userId)).toEqual([]);
    expect(await liveResetCodes(l.userId)).toBe(0);
    expect((await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: l.userId } })).mustChange).toBe(true);
    expect(await login("0912345678", r.temporaryPassword)).toBe("set_password");
    const [entry] = await auditRows("learner_password_reset");
    expect(entry).toMatchObject({ admin_user_id: owner.adminId, target_id: l.userId, result: "ok", reason: "khách mất mật khẩu" });
    const { rows } = await sqlAsMigrator(`SELECT after::text AS after FROM admin_audit_log WHERE action = 'learner_password_reset'`);
    expect(rows[0].after).toContain("MEAAAAAAAB");
    expect(rows[0].after).not.toContain(r.temporaryPassword);
  });

  it("không có số + mật khẩu: không kèm số → no_password_login; kèm số chưa ai dùng → gắn số mới; số người khác đang giữ → phone_taken", async () => {
    const owner = await adminCtx("owner");
    const input = { reason: "khôi phục", evidence: "mã đơn MEAAAAAAAB" };
    const l = await testLearner("Email");
    expect(await adminResetPassword(owner, l.userId, input)).toEqual({ kind: "no_password_login" });
    await phoneLearner("0987654321");
    expect(await adminResetPassword(owner, l.userId, { ...input, phone: "0987654321" })).toEqual({ kind: "phone_taken" });
    const r = await adminResetPassword(owner, l.userId, { ...input, phone: "0912345678" });
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(await login("0912345678", r.temporaryPassword)).toBe("set_password");
  });
});

describe("khóa đồng thời", () => {
  it("đăng nhập và gộp chạy cùng lúc nhiều lần: không kẹt khóa, không lỗi", async () => {
    const owner = await adminCtx("owner");
    for (let i = 0; i < 4; i++) {
      const phone = `09600000${String(i).padStart(2, "0")}`;
      const source = await phoneLearner(phone);
      const target = await testLearner(`Đích ${i}`);
      const [merged, next] = await Promise.all([
        mergeAccounts(owner, { sourceUserId: source.userId, targetUserId: target.userId, reason: "gộp", preview: false }),
        login(phone, PW),
      ]);
      expect(merged).toBe("merged");
      expect(["done", "invalid"]).toContain(next);
    }
  });

  it("thêm số cho tài khoản vừa bị gộp → không tạo dòng mồ côi", async () => {
    const source = await testLearner("Nguồn");
    const target = await testLearner("Đích");
    await mergeAccounts(await adminCtx("owner"), { sourceUserId: source.userId, targetUserId: target.userId, reason: "gộp", preview: false });
    const { changeOwnPassword } = await import("@/modules/auth-learner/password");
    expect(await changeOwnPassword(source, { phone: "0912345678", newPassword: NEW_PW })).toEqual({ kind: "inactive" });
    expect(await prisma().passwordLogin.count()).toBe(0);
  });
});

describe("quản trị tìm và xem học viên có số + mật khẩu", () => {
  it("tìm theo số ra học viên chỉ có số + mật khẩu; kết quả hiện số (chủ thấy đủ, hỗ trợ thấy che) và trạng thái chưa xác minh", async () => {
    const l = await phoneLearner();
    const [found] = await searchLearners(await adminCtx("owner"), "0912345678");
    expect(found).toMatchObject({ id: l.userId, passwordLogin: { phone: "+84912345678", verified: false, released: false, mustChange: false } });
    const [masked] = await searchLearners(await adminCtx("support"), "+84912345678");
    expect(masked!.passwordLogin!.phone).toBe("+84•••••678");
  });
});

describe("gộp tài khoản có số + mật khẩu", () => {
  const reason = "khách có hai tài khoản";

  it("nguồn có, đích chưa có → chuyển sang đích; đăng nhập bằng số vào đích", async () => {
    const source = await phoneLearner();
    const target = await testLearner("Đích");
    expect(await mergeAccounts(await adminCtx("owner"), { sourceUserId: source.userId, targetUserId: target.userId, reason, preview: false })).toBe("merged");
    expect((await prisma().passwordLogin.findFirstOrThrow()).userId).toBe(target.userId);
    expect(await login("0912345678", PW)).toBe("done");
  });

  it("cả hai đều có → password_conflict, không đổi gì", async () => {
    const source = await phoneLearner("0912345678");
    const target = await phoneLearner("0987654321");
    expect(await mergeAccounts(await adminCtx("owner"), { sourceUserId: source.userId, targetUserId: target.userId, reason, preview: false })).toBe("password_conflict");
    expect((await prisma().user.findUniqueOrThrow({ where: { id: source.userId } })).status).toBe("active");
  });

  it("dòng nhả của nguồn không chuyển; đích chỉ có dòng nhả thì dòng chưa nhả của nguồn thay vào", async () => {
    const owner = await adminCtx("owner");
    const releasedSource = await phoneLearner("0912345678");
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84912345678", displayName: "Chủ số", rank: null }));
    const target = await phoneLearner("0987654321");
    expect(await mergeAccounts(owner, { sourceUserId: releasedSource.userId, targetUserId: target.userId, reason, preview: false })).toBe("merged");
    expect((await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: releasedSource.userId } })).releasedAt).not.toBeNull();
    expect((await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: target.userId } })).phoneCanonical).toBe("+84987654321");

    const releasedTarget = await phoneLearner("0944444444");
    await withTx((tx) => createUserWithIdentity(tx, { kind: "phone", value: "+84944444444", displayName: "Chủ số 2", rank: null }));
    const liveSource = await phoneLearner("0955555555");
    expect(await mergeAccounts(owner, { sourceUserId: liveSource.userId, targetUserId: releasedTarget.userId, reason, preview: false })).toBe("merged");
    expect(await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: releasedTarget.userId } }))
      .toMatchObject({ phoneCanonical: "+84955555555", releasedAt: null });
    expect((await prisma().passwordLogin.findUniqueOrThrow({ where: { userId: liveSource.userId } })).releasedAt).not.toBeNull();
    const { rows } = await sqlAsMigrator(`SELECT after::text AS after FROM admin_audit_log WHERE action = 'account_merge' AND target_id = $1`, [releasedTarget.userId]);
    expect(JSON.parse(rows[0].after).passwordLogin).toEqual({ action: "replaced_released", replacedPhone: "•••• 4444", phone: "•••• 5555" });
    expect(rows[0].after).not.toMatch(/scrypt/);
    expect(await login("0955555555", PW)).toBe("done");
  });
});
