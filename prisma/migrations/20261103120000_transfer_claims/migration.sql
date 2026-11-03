-- Chủ quyết định 03/11/2026 (chưa có SePay): khách bấm "Tôi đã chuyển khoản" là được học ngay (quyền mở tạm, không hết hạn);
-- chủ "Duyệt" (tự xác nhận một bước) hoặc "Không thấy tiền" (khóa lại, kèm lý do); khách bị khóa gửi được ảnh chứng minh.
-- Đơn chỉ thành "đã thanh toán" qua dòng sổ đã xác minh như cũ: quyền mở tạm không đụng tới đơn.

-- ===== Quyền mở tạm =====
ALTER TABLE "enrollments" ADD COLUMN "claim_order_id" UUID REFERENCES "orders"("id") ON DELETE RESTRICT;
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_source_check";
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_source_check" CHECK ("source" IN ('order', 'grant', 'provisional'));
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_provisional_source_check"
  CHECK (("source" = 'provisional') = ("claim_order_id" IS NOT NULL AND "order_id" IS NULL AND "grant_reason" IS NULL AND "granted_by" IS NULL));
-- Mỗi đơn chỉ được mở tạm một lần (bị khóa lại thì không mở tạm lại được).
CREATE UNIQUE INDEX "enrollments_claim_order_course_key" ON "enrollments" ("claim_order_id", "course_id");

CREATE OR REPLACE FUNCTION "enrollments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."user_id", NEW."course_id", NEW."source", NEW."order_id", NEW."grant_reason", NEW."granted_by", NEW."created_at", NEW."claim_order_id")
     IS DISTINCT FROM (OLD."id", OLD."user_id", OLD."course_id", OLD."source", OLD."order_id", OLD."grant_reason", OLD."granted_by", OLD."created_at", OLD."claim_order_id")
     OR (OLD."revoked_at" IS NOT NULL AND (NEW."revoked_at", NEW."revoked_reason") IS DISTINCT FROM (OLD."revoked_at", OLD."revoked_reason")) THEN
    RAISE EXCEPTION 'enrollment_immutable';
  END IF;
  RETURN NEW;
END $$;

-- ===== Chủ tự xác nhận một bước =====
ALTER TABLE "bank_transaction_verifications" DROP CONSTRAINT "bank_transaction_verifications_method_check";
ALTER TABLE "bank_transaction_verifications" ADD CONSTRAINT "bank_transaction_verifications_method_check"
  CHECK ("method" IN ('provider', 'provider_match', 'owner', 'owner_direct'));
ALTER TABLE "bank_transaction_verifications" DROP CONSTRAINT "verifications_owner_check";
ALTER TABLE "bank_transaction_verifications" ADD CONSTRAINT "verifications_owner_check"
  CHECK (("method" IN ('owner', 'owner_direct')) = ("verified_by" IS NOT NULL AND "evidence" IS NOT NULL));

-- 'owner' vẫn cấm tự xác minh dòng mình nhập; 'owner_direct' chỉ cho tài khoản chủ đang hoạt động.
CREATE OR REPLACE FUNCTION "verifications_not_self_check"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."method" = 'owner' AND NEW."verified_by" = (SELECT "entered_by" FROM "bank_transactions" WHERE "id" = NEW."bank_transaction_id") THEN
    RAISE EXCEPTION 'verify_own_entry';
  END IF;
  IF NEW."method" = 'owner_direct' AND NOT EXISTS (
       SELECT 1 FROM "admin_users" WHERE "id" = NEW."verified_by" AND "role" = 'owner' AND "status" = 'active') THEN
    RAISE EXCEPTION 'owner_direct_requires_owner';
  END IF;
  RETURN NEW;
END $$;

-- ===== Khóa lại và ảnh chứng minh =====
CREATE TABLE "transfer_claim_rejections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "reason" TEXT NOT NULL CHECK (length("reason") BETWEEN 1 AND 500),
  "decided_by" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "transfer_claim_rejections_order_idx" ON "transfer_claim_rejections" ("order_id", "created_at");
CREATE TRIGGER "transfer_claim_rejections_immutable" BEFORE UPDATE OR DELETE ON "transfer_claim_rejections"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

CREATE TABLE "transfer_proofs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "order_id" UUID NOT NULL REFERENCES "orders"("id") ON DELETE RESTRICT,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "message" TEXT NOT NULL CHECK (length("message") <= 1000),
  "storage_key" TEXT NOT NULL,
  "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "mime" TEXT NOT NULL CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  "bytes" INTEGER NOT NULL CHECK ("bytes" > 0),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE INDEX "transfer_proofs_order_idx" ON "transfer_proofs" ("order_id", "created_at");
CREATE TRIGGER "transfer_proofs_immutable" BEFORE UPDATE OR DELETE ON "transfer_proofs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

GRANT SELECT, INSERT ON "transfer_claim_rejections", "transfer_proofs" TO me_app;
