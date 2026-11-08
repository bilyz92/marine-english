import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTest } from "@/lib/env";
import { POST as quickRoute } from "@/app/api/auth/learner/password/quick-register/route";
import { POST as loginRoute } from "@/app/api/auth/learner/password/login/route";
import { POST as orderRoute } from "@/app/api/me/orders/route";
import { POST as claimRoute } from "@/app/api/me/orders/[code]/claim/route";
import { GET as credentialsRoute } from "@/app/api/me/credentials/route";
import { approveTransfer } from "@/modules/orders/claims";
import { adminResetPassword } from "@/modules/auth-learner/password";
import { readPendingCredentials } from "@/modules/auth-learner/pending-credentials";
import { mergeAccounts } from "@/modules/enrollments/merge";
import { adminCtx } from "../helpers/admin-ctx";
import { publish, seedContent } from "../helpers/content";
import { cookieValue, newDeviceKey, ORIGIN } from "../helpers/learner";
import { learnerRequest, testLearner, type TestLearner } from "../helpers/learner-ctx";
import { sqlAsMigrator } from "../helpers/otp";

// Chủ 09/11/2026: bước 1 không hiện mật khẩu; bước 3 (đã báo chuyển khoản / đã thanh toán) hiện số + mật khẩu tạm;
// lần đầu đăng nhập bằng mật khẩu tạm phải đặt mật khẩu mới (docs/superpowers/plans/2026-11-09-checkout-credentials.md).

const SLUG = "engine_cadet_tanker";
let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;

beforeEach(() => {
  // Chưa có SePay: khách báo chuyển khoản là sang bước 3.
  vi.stubEnv("SEPAY_WEBHOOK_SECRETS", "");
  resetEnvForTest();
});
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTest();
});

async function guest(phone: string, email?: string, emailConfirm = email): Promise<{ who: TestLearner; body: Record<string, unknown>; status: number }> {
  const res = await quickRoute(new Request(`${ORIGIN}/api/auth/learner/password/quick-register`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ displayName: "Khách", phone, deviceKey: newDeviceKey(), deviceLabel: "Máy", ...(email ? { email, emailConfirm } : {}) }),
  }));
  const body = (await res.json()) as Record<string, unknown>;
  const token = cookieValue(res, "__Host-me_learn")!;
  const csrf = cookieValue(res, "__Host-me_csrf_learner")!;
  return { who: { token, csrf } as TestLearner, body, status: res.status };
}
/** Như trình duyệt: phiên đổi mã thì dùng cookie mới cho lần gọi sau. */
function follow(who: TestLearner, res: Response): Response {
  const token = cookieValue(res, "__Host-me_learn");
  const csrf = cookieValue(res, "__Host-me_csrf_learner");
  if (token) who.token = token;
  if (csrf) who.csrf = csrf;
  return res;
}
const order = async (who: TestLearner) => {
  const res = follow(who, await orderRoute(learnerRequest("/api/me/orders", who, { method: "POST", body: { courseSlug: SLUG, acceptTerms: true } })));
  return { status: res.status, code: ((await res.json()) as { code?: string }).code ?? "" };
};
const claim = async (who: TestLearner, code: string) =>
  follow(who, await claimRoute(learnerRequest(`/api/me/orders/${code}/claim`, who, { method: "POST", body: {} }), { params: Promise.resolve({ code }) }));
async function credentials(who: TestLearner, code: string) {
  const res = follow(who, await credentialsRoute(learnerRequest(`/api/me/credentials?order=${code}`, who)));
  return { cache: res.headers.get("cache-control") ?? "", body: (await res.json()) as { available: boolean; phone?: string; password?: string; email?: string | null } };
}
async function login(phone: string, password: string, newPassword?: string) {
  const res = await loginRoute(new Request(`${ORIGIN}/api/auth/learner/password/login`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": freshIp() },
    body: JSON.stringify({ phone, password, deviceKey: newDeviceKey(), deviceLabel: "Máy khác", ...(newPassword ? { newPassword } : {}) }),
  }));
  return (await res.json()) as { next?: string; error?: string };
}

describe("thông tin tài khoản ở bước 3", () => {
  it("bước 1 không trả mật khẩu; mật khẩu tạm bắt đổi; DB chỉ có bản băm và bản mã hóa", async () => {
    await seedContent();
    await publish(SLUG);
    const { body } = await guest("0915000101");
    expect(body).toEqual({ next: "done" });
    const { rows } = await sqlAsMigrator(`SELECT must_change FROM password_logins WHERE phone_canonical = '+84915000101'`);
    expect(rows[0].must_change).toBe(true);
    const pending = await sqlAsMigrator(`SELECT p.password_enc FROM learner_pending_credentials p JOIN password_logins l ON l.user_id = p.user_id WHERE l.phone_canonical = '+84915000101'`);
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].password_enc).toMatch(/^v1\./);
  });

  it("đơn chờ thanh toán: chưa có; báo chuyển khoản: có số + mật khẩu; đăng nhập bằng nó → đặt mật khẩu mới; đặt xong → hết", async () => {
    await seedContent();
    await publish(SLUG);
    const { who, body: reg } = await guest("0915000202");
    expect(reg).toEqual({ next: "done" });
    const { status, code } = await order(who);
    expect(status).toBe(201);
    expect((await credentials(who, code)).body).toEqual({ available: false });
    expect((await claim(who, code)).status).toBe(200);
    const shown = await credentials(who, code);
    expect(shown.cache).toContain("no-store");
    expect(shown.body).toMatchObject({ available: true, phone: "0915000202", email: null });
    expect(shown.body.password).toMatch(/^[A-HJKMNP-Za-hjkmnp-z2-9]{10}$/);
    const pending = await sqlAsMigrator(`SELECT password_enc FROM learner_pending_credentials`);
    expect(JSON.stringify(pending.rows)).not.toContain(shown.body.password);
    expect((await login("0915000202", shown.body.password!)).next).toBe("set_password");
    expect((await login("0915000202", shown.body.password!, "Thuyen vien moi 2026")).next).toBe("done");
    // Đặt mật khẩu mới thì các máy khác bị đăng xuất (phiên cũ hết hiệu lực); bản chờ cũng bị xóa.
    expect((await credentials(who, code)).body).toMatchObject({ error: expect.any(String) });
    const left = await sqlAsMigrator(`SELECT count(*)::int AS n FROM learner_pending_credentials p JOIN password_logins l ON l.user_id = p.user_id WHERE l.phone_canonical = '+84915000202'`);
    expect(left.rows[0].n).toBe(0);
  });

  it("đơn đã thanh toán vẫn hiện; người khác hỏi đơn này → không có; đơn hết hạn không báo → không có", async () => {
    await seedContent();
    await publish(SLUG);
    const { who } = await guest("0915000303");
    const { code } = await order(who);
    await claim(who, code);
    const r = await approveTransfer(await adminCtx("owner"), { orderCode: code, bankRef: "", note: "", bankTime: new Date() });
    expect(r).toEqual({ result: "paid" });
    expect((await credentials(who, code)).body.available).toBe(true);
    const other = await testLearner("Người khác");
    expect((await credentials(other, code)).body).toEqual({ available: false });

    const second = await guest("0915000304");
    const late = await order(second.who);
    await sqlAsMigrator(`UPDATE orders SET status = 'expired' WHERE code = $1`, [late.code]);
    expect((await credentials(second.who, late.code)).body).toEqual({ available: false });
  });

  it("tạo đơn lần đầu lỗi (chưa mở thanh toán) rồi tạo lại, báo chuyển khoản → vẫn lấy được mật khẩu", async () => {
    await seedContent();
    await publish(SLUG);
    const { who } = await guest("0915000404");
    vi.stubEnv("CHECKOUT_TERMS_VERSION", "");
    resetEnvForTest();
    expect((await order(who)).status).toBe(503);
    vi.unstubAllEnvs();
    vi.stubEnv("SEPAY_WEBHOOK_SECRETS", "");
    resetEnvForTest();
    const { code } = await order(who);
    await claim(who, code);
    expect((await credentials(who, code)).body.available).toBe(true);
  });

  it("email ở bước 1: lưu làm email liên hệ, không thành định danh đăng nhập", async () => {
    await seedContent();
    const { body } = await guest("0915000505", " Khach.Moi@X.vn ");
    expect(body).toEqual({ next: "done" });
    const contact = await sqlAsMigrator(`SELECT c.email FROM learner_contact_emails c JOIN password_logins l ON l.user_id = c.user_id WHERE l.phone_canonical = '+84915000505'`);
    expect(contact.rows).toEqual([{ email: "khach.moi@x.vn" }]);
    const ids = await sqlAsMigrator(`SELECT count(*)::int AS n FROM user_identities WHERE value_canonical = 'khach.moi@x.vn'`);
    expect(ids.rows[0].n).toBe(0);
  });

  it("email nhập lại không khớp → 400 email_mismatch, không tạo tài khoản (email sai thì người lạ nhận mật khẩu)", async () => {
    await seedContent();
    const r = await guest("0915000606", "dung@x.vn", "dug@x.vn");
    expect([r.status, r.body]).toEqual([400, { error: "email_mismatch" }]);
    const { rows } = await sqlAsMigrator(`SELECT count(*)::int AS n FROM password_logins WHERE phone_canonical = '+84915000606'`);
    expect(rows[0].n).toBe(0);
  });

  it("chủ đặt mật khẩu tạm mới → bản chờ cũ bị bỏ", async () => {
    await seedContent();
    await guest("0915000707");
    const { rows: [u] } = await sqlAsMigrator(`SELECT user_id FROM password_logins WHERE phone_canonical = '+84915000707'`);
    expect(await readPendingCredentials(u.user_id)).not.toBeNull();
    const r = await adminResetPassword(await adminCtx("owner"), u.user_id, { reason: "Khách quên", evidence: "Gọi điện xác nhận" });
    expect(r.kind).toBe("ok");
    expect(await readPendingCredentials(u.user_id)).toBeNull();
  });

  it("gộp tài khoản (nguồn có số + mật khẩu tạm, đích chưa có) → bản chờ của nguồn bị bỏ", async () => {
    await seedContent();
    await guest("0915000808");
    const { rows: [u] } = await sqlAsMigrator(`SELECT user_id FROM password_logins WHERE phone_canonical = '+84915000808'`);
    const target = await testLearner("Tài khoản chính");
    expect(await mergeAccounts(await adminCtx("owner"), { sourceUserId: u.user_id, targetUserId: target.userId, reason: "khách có hai tài khoản", preview: false })).toBe("merged");
    expect(await readPendingCredentials(u.user_id)).toBeNull();
    expect(await readPendingCredentials(target.userId)).toBeNull();
  });

  it("bước 3 hiện đúng email sẽ nhận thư: email đã xác minh được ưu tiên hơn email liên hệ", async () => {
    await seedContent();
    await publish(SLUG);
    const { who } = await guest("0915000909", "lienhe@x.vn");
    const { code } = await order(who);
    await claim(who, code);
    expect((await credentials(who, code)).body.email).toBe("lienhe@x.vn");
    const { rows: [u] } = await sqlAsMigrator(`SELECT user_id FROM password_logins WHERE phone_canonical = '+84915000909'`);
    await sqlAsMigrator(`INSERT INTO user_identities (user_id, kind, value_canonical, verified_at) VALUES ($1, 'email', 'da-xac-minh@x.vn', now())`, [u.user_id]);
    expect((await credentials(who, code)).body.email).toBe("da-xac-minh@x.vn");
  });
});
