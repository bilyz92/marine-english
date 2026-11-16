-- Đơn của khách chưa có tài khoản (chủ 16/11/2026, docs/superpowers/plans/2026-11-16-guest-orders.md):
-- đơn tạo khi chưa có tài khoản; tài khoản tạo trong cùng transaction nhận tiền.

ALTER TABLE "orders" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_when_paid" CHECK ("user_id" IS NOT NULL OR "status" IN ('pending', 'expired'));
ALTER TABLE "order_terms_acceptances" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE TABLE "guest_orders" (
  "order_id" UUID NOT NULL PRIMARY KEY REFERENCES "orders"("id") ON DELETE RESTRICT,
  "display_name" TEXT NOT NULL CHECK (length("display_name") BETWEEN 1 AND 100),
  "phone_canonical" TEXT NOT NULL CHECK ("phone_canonical" ~ '^\+84[0-9]{9}$'),
  "email" TEXT NOT NULL CHECK ("email" <> ''),
  "password_hash" TEXT NOT NULL CHECK ("password_hash" LIKE 'scrypt$%'),
  "password_enc" TEXT,
  "access_token_hash" TEXT NOT NULL CONSTRAINT "guest_orders_access_token_hash_key" UNIQUE,
  "created_ip" INET NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "user_id" UUID REFERENCES "users"("id") ON DELETE RESTRICT,
  -- Chưa có tài khoản thì phải còn mật khẩu tạm niêm phong (đường duy nhất để khách đăng nhập sau khi trả tiền).
  CONSTRAINT "guest_orders_password_until_account" CHECK ("user_id" IS NOT NULL OR "password_enc" IS NOT NULL)
);
CREATE INDEX "guest_orders_phone_idx" ON "guest_orders" ("phone_canonical");
CREATE INDEX "guest_orders_email_idx" ON "guest_orders" ("email");

-- Chỉ được: đặt user_id một lần (NULL → giá trị) và xóa bản mật khẩu niêm phong. Không xóa dòng.
CREATE FUNCTION "guest_orders_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'guest_order_immutable';
  END IF;
  IF NEW."order_id" IS DISTINCT FROM OLD."order_id" OR NEW."display_name" IS DISTINCT FROM OLD."display_name"
     OR NEW."phone_canonical" IS DISTINCT FROM OLD."phone_canonical" OR NEW."email" IS DISTINCT FROM OLD."email"
     OR NEW."password_hash" IS DISTINCT FROM OLD."password_hash" OR NEW."access_token_hash" IS DISTINCT FROM OLD."access_token_hash"
     OR NEW."created_ip" IS DISTINCT FROM OLD."created_ip" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR (NEW."user_id" IS DISTINCT FROM OLD."user_id" AND OLD."user_id" IS NOT NULL)
     OR (NEW."password_enc" IS DISTINCT FROM OLD."password_enc" AND NEW."password_enc" IS NOT NULL) THEN
    RAISE EXCEPTION 'guest_order_immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "guest_orders_guard" BEFORE UPDATE OR DELETE ON "guest_orders" FOR EACH ROW EXECUTE FUNCTION "guest_orders_guard"();

-- Mỗi đơn lúc tạo: có người mua (user_id) hoặc có dòng guest_orders (kiểm lúc commit).
CREATE FUNCTION "orders_owner_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."user_id" IS NULL AND NOT EXISTS (SELECT 1 FROM "guest_orders" WHERE "order_id" = NEW."id") THEN
    RAISE EXCEPTION 'order_without_owner';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "orders_owner_check" AFTER INSERT ON "orders" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "orders_owner_check"();

-- Bất biến của đơn, so sánh an toàn với NULL. user_id chỉ đổi theo một kiểu: đơn khách NULL → đúng người đã ghi ở guest_orders.
CREATE OR REPLACE FUNCTION "orders_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."amount_due_vnd" IS DISTINCT FROM OLD."amount_due_vnd"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."refund_policy_version" IS DISTINCT FROM OLD."refund_policy_version"
     OR NEW."created_xact" IS DISTINCT FROM OLD."created_xact" THEN
    RAISE EXCEPTION 'order_immutable';
  END IF;
  IF NEW."user_id" IS DISTINCT FROM OLD."user_id" AND NOT (
       OLD."user_id" IS NULL AND NEW."user_id" IS NOT NULL
       AND NEW."user_id" IS NOT DISTINCT FROM (SELECT "user_id" FROM "guest_orders" WHERE "order_id" = NEW."id")) THEN
    RAISE EXCEPTION 'order_immutable';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'pending' AND NEW."status" IN ('paid', 'expired'))
    OR (OLD."status" = 'expired' AND NEW."status" = 'paid')
    OR (OLD."status" = 'paid' AND NEW."status" = 'refunded')) THEN
    RAISE EXCEPTION 'order_transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE "password_attempts" DROP CONSTRAINT "password_attempts_kind_check";
ALTER TABLE "password_attempts" ADD CONSTRAINT "password_attempts_kind_check" CHECK ("kind" IN ('login', 'current', 'register', 'reset', 'guest_order'));

GRANT SELECT, INSERT ON "guest_orders" TO me_app;
GRANT UPDATE ("user_id", "password_enc") ON "guest_orders" TO me_app;
