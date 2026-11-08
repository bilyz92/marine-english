-- Thông tin tài khoản khách mua không cần đăng nhập (chủ 09/11/2026, docs/superpowers/plans/2026-11-09-checkout-credentials.md).
-- Mật khẩu tạm giữ ở dạng mã hóa (AES-256-GCM, khóa SESSION_ENC_KEYS, ngoài DB) để hiện ở bước 3 và gửi email khi thanh toán xong;
-- mất hiệu lực khi mật khẩu đổi, tài khoản gộp/nhả số, hoặc sau 30 ngày (job dọn). Chỉ thêm bảng.
CREATE TABLE "learner_pending_credentials" (
  "user_id" UUID NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "password_enc" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "emailed_at" TIMESTAMPTZ(6)
);

-- Email khách nhập ở trang mua: chưa xác minh, chỉ để gửi thư (không đăng nhập, không phải user_identities).
CREATE TABLE "learner_contact_emails" (
  "user_id" UUID NOT NULL PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON "learner_pending_credentials" TO me_app;
GRANT UPDATE ("emailed_at") ON "learner_pending_credentials" TO me_app;
GRANT SELECT, INSERT, DELETE ON "learner_contact_emails" TO me_app;

-- Mọi đường đổi mật khẩu (đặt mới lần đầu, quên mật khẩu, đổi trong Tài khoản, chủ đặt tạm), nhả số hay gộp tài khoản
-- đều đi qua password_logins: bỏ bản chờ ngay tại đó để không đường nào sót.
CREATE FUNCTION "drop_pending_credentials"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."password_hash" IS DISTINCT FROM OLD."password_hash"
     OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
     OR (NEW."released_at" IS NOT NULL AND OLD."released_at" IS NULL) THEN
    DELETE FROM "learner_pending_credentials" WHERE "user_id" = OLD."user_id";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "password_logins_drop_pending" AFTER UPDATE ON "password_logins"
  FOR EACH ROW EXECUTE FUNCTION "drop_pending_credentials"();
