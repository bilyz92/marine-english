-- BR-18: tiền hoàn chỉ chuyển về tài khoản học viên khai. Ghi tài khoản nhận vào yêu cầu; chỉ sửa được khi còn “đề nghị”;
-- không duyệt khi chưa có. Học viên tự gửi yêu cầu (FR-28) thì ghi người gửi ở requested_by_user.
ALTER TABLE "refunds" ADD COLUMN "payout_bank_name" TEXT;
ALTER TABLE "refunds" ADD COLUMN "payout_account_no" TEXT;
ALTER TABLE "refunds" ADD COLUMN "payout_account_name" TEXT;
ALTER TABLE "refunds" ADD COLUMN "requested_by_user" UUID REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payout_complete" CHECK (
  ("payout_bank_name" IS NULL) = ("payout_account_no" IS NULL) AND ("payout_account_no" IS NULL) = ("payout_account_name" IS NULL));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payout_format" CHECK ("payout_account_no" IS NULL OR "payout_account_no" ~ '^[0-9]{4,30}$');
-- Yêu cầu cũ (trước BR-18) giữ nguyên; từ nay duyệt/chuyển/xác nhận đều phải có tài khoản nhận.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payout_before_approve" CHECK ("status" IN ('requested', 'cancelled') OR "payout_account_no" IS NOT NULL) NOT VALID;

CREATE OR REPLACE FUNCTION "refunds_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."order_id" <> OLD."order_id" OR NEW."kind" <> OLD."kind" OR NEW."amount_vnd" <> OLD."amount_vnd"
     OR NEW."requested_by_user" IS DISTINCT FROM OLD."requested_by_user" THEN
    RAISE EXCEPTION 'refund_immutable';
  END IF;
  IF (NEW."payout_bank_name", NEW."payout_account_no", NEW."payout_account_name")
       IS DISTINCT FROM (OLD."payout_bank_name", OLD."payout_account_no", OLD."payout_account_name")
     AND OLD."status" <> 'requested' THEN
    RAISE EXCEPTION 'refund_payout_locked';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'requested' AND NEW."status" IN ('approved', 'cancelled'))
    OR (OLD."status" = 'approved' AND NEW."status" IN ('sent', 'cancelled'))
    OR (OLD."status" = 'sent' AND NEW."status" IN ('confirmed', 'failed'))) THEN
    RAISE EXCEPTION 'refund_transition % -> %', OLD."status", NEW."status";
  END IF;
  RETURN NEW;
END $$;
