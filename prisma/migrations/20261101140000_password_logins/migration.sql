-- D2 (01/11/2026): học viên đăng ký và đăng nhập bằng số điện thoại + mật khẩu. Số chưa xác minh, lưu riêng ở đây, không bao giờ ở
-- user_identities (chỉ danh tính đã xác minh). Số đã xác minh của người khác thắng: dòng ở đây bị nhả (released_at) chứ không chặn.
CREATE TABLE "password_logins" (
  "user_id" UUID NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE RESTRICT,
  "phone_canonical" TEXT NOT NULL CHECK ("phone_canonical" ~ '^\+84[35789][0-9]{8}$'),
  "password_hash" TEXT NOT NULL CHECK ("password_hash" LIKE 'scrypt$%'),
  "phone_verified_at" TIMESTAMPTZ(6),
  "released_at" TIMESTAMPTZ(6),
  "must_change" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "password_logins_phone_live_key" ON "password_logins" ("phone_canonical") WHERE "released_at" IS NULL;

-- Mọi lần kiểm mật khẩu và mọi lần đăng ký: đếm khóa theo số (kể cả số không có tài khoản) và theo IP. Giữ 30 ngày (job dọn).
CREATE TABLE "password_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('login', 'current', 'register')),
  "ip" INET NOT NULL,
  "phone_canonical" TEXT,
  "ok" BOOLEAN NOT NULL,
  "at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "password_attempts_phone_at_idx" ON "password_attempts" ("phone_canonical", "at");
CREATE INDEX "password_attempts_ip_at_idx" ON "password_attempts" ("ip", "at");

-- Mã đặt lại mật khẩu qua email đã liên kết: gắn với đúng học viên như mã liên kết.
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_purpose_check";
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_purpose_check" CHECK ("purpose" IN ('signup', 'login', 'link', 'reset'));
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenges_link_user_check";
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_link_user_check" CHECK (("purpose" IN ('link', 'reset')) = ("user_id" IS NOT NULL));

GRANT SELECT, INSERT, UPDATE ON "password_logins" TO me_app;
GRANT SELECT, INSERT, UPDATE ON "password_attempts" TO me_app;
-- Không có DELETE: lịch sử lượt thử chỉ được dọn qua hàm riêng (dòng quá 30 ngày), xem migration của job dọn.
