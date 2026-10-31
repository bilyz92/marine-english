import { randomBytes } from "node:crypto";

// Biến môi trường cho test: khóa sinh ngẫu nhiên mỗi lần chạy, không ghi ra đĩa.
// Mật khẩu DB là mật khẩu dev cố định trong docker/postgres-init.sql.
const PG = process.env.TEST_PG_HOSTPORT ?? "localhost:55433";
const key = () => randomBytes(32).toString("base64");

export function applyTestEnv(): void {
  const defaults: Record<string, string> = {
    DATABASE_URL: `postgresql://me_app:me_app_dev@${PG}/me_test`,
    MIGRATOR_DATABASE_URL: `postgresql://me_migrator:me_migrator_dev@${PG}/me_test`,
    SHADOW_DATABASE_URL: `postgresql://me_migrator:me_migrator_dev@${PG}/me_shadow`,
    ME_OTHER_DATABASE_URL: `postgresql://me_other:me_other_dev@${PG}/me_test`,
    APP_ORIGIN: "http://localhost:3000",
    SESSION_KEY_LEARNER: key(),
    SESSION_KEY_ADMIN: key(),
    CSRF_KEY_LEARNER: key(),
    CSRF_KEY_ADMIN: key(),
    SESSION_ENC_KEYS: `k1:${key()},k2:${key()}`,
    SESSION_ENC_KEY_CURRENT: "k1",
    OTP_PEPPERS: `v1:${key()},v2:${key()}`,
    OTP_PEPPER_CURRENT: "v1",
    OIDC_STATE_KEY: key(),
    GOOGLE_CLIENT_ID: "test-client",
    GOOGLE_CLIENT_SECRET: "test-secret",
    GOOGLE_ISSUER: "https://accounts.google.com",
    ZALO_LOGIN_ENABLED: "false",
    ZNS_DAILY_BUDGET: "500",
    MAX_DEVICES: "2",
    LICENSE_SIGNING_KEYS: `l1:${key()},l2:${key()}`,
    LICENSE_SIGNING_KID_CURRENT: "l2",
    SEPAY_BANK_CODE: "VCB",
    SEPAY_ACCOUNT_NO: "0123456789",
    SEPAY_WEBHOOK_SECRETS: "s2:bi-mat-moi-dung-trong-test,s1:bi-mat-cu-dung-trong-test",
    CHECKOUT_BANK_NAME: "Ngan hang thu",
    CHECKOUT_ACCOUNT_NAME: "TEN THU NGHIEM",
    CHECKOUT_QR_IMAGE: "/media/qr-thu.png",
    CHECKOUT_TERMS_VERSION: "thu-nghiem-1",
  };
  for (const [name, value] of Object.entries(defaults)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}
