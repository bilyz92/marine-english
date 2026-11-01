-- Hoàn một khoản chuyển đang ở hàng chờ, chưa ghép vào đơn nào (UC-09 khách chuyển thiếu/sai; UC-10 “cần xử lý tay”; DG §2.1, §2.8).
-- Loại 'unallocated': không có đơn, đúng một dòng sổ nguồn, hoàn trọn số tiền của dòng đó. Khi còn hiệu lực (chưa hủy, chưa lỗi),
-- dòng sổ không được phân bổ cho đơn hay nhận kết luận “trùng/bỏ qua”, và ngược lại.
ALTER TABLE "refunds" ALTER COLUMN "order_id" DROP NOT NULL;
ALTER TABLE "refunds" DROP CONSTRAINT "refunds_kind_check";
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_kind_check" CHECK ("kind" IN ('full', 'excess', 'unallocated'));
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_by_kind" CHECK (("kind" = 'unallocated') = ("order_id" IS NULL));

-- Dòng sổ đang bị một đề nghị hoàn khoản chưa ghép giữ.
CREATE FUNCTION "bank_transaction_refund_held"("p_id" UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "refund_sources" s JOIN "refunds" r ON r."id" = s."refund_id"
    WHERE s."bank_transaction_id" = "p_id" AND r."kind" = 'unallocated' AND r."status" NOT IN ('failed', 'cancelled'))
$$;

CREATE OR REPLACE FUNCTION "settlement_exclusive_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_allocated BOOLEAN := EXISTS (SELECT 1 FROM "payment_allocations" WHERE "bank_transaction_id" = NEW."bank_transaction_id");
  v_disposed BOOLEAN := EXISTS (
    SELECT 1 FROM "bank_transaction_dispositions" WHERE "bank_transaction_id" = NEW."bank_transaction_id" AND "superseded_at" IS NULL);
BEGIN
  IF (v_allocated AND v_disposed) OR ((v_allocated OR v_disposed) AND "bank_transaction_refund_held"(NEW."bank_transaction_id")) THEN
    RAISE EXCEPTION 'settlement_conflict';
  END IF;
  RETURN NULL;
END $$;

-- order_id có thể NULL: so bằng IS DISTINCT FROM để không lọt thay đổi NULL ↔ giá trị.
CREATE OR REPLACE FUNCTION "refunds_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."order_id" IS DISTINCT FROM OLD."order_id" OR NEW."kind" <> OLD."kind" OR NEW."amount_vnd" <> OLD."amount_vnd"
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

CREATE OR REPLACE FUNCTION "refund_money_check"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r "refunds"%ROWTYPE;
  v_refund_id UUID;
BEGIN
  -- Dùng chung cho refunds (id) và refund_sources (refund_id).
  v_refund_id := coalesce((to_jsonb(NEW) ->> 'refund_id')::uuid, (to_jsonb(NEW) ->> 'id')::uuid);
  SELECT * INTO r FROM "refunds" WHERE "id" = v_refund_id;
  IF r."status" IN ('failed', 'cancelled') THEN
    RETURN NULL;
  END IF;
  IF r."kind" = 'unallocated' THEN
    -- Đúng một dòng sổ, hoàn trọn số tiền, dòng đó chưa phân bổ cho đơn nào và không có kết luận hiệu lực.
    IF (SELECT count(*) FROM "refund_sources" WHERE "refund_id" = r."id") <> 1 OR EXISTS (
      SELECT 1 FROM "refund_sources" s JOIN "bank_transactions" bt ON bt."id" = s."bank_transaction_id"
      WHERE s."refund_id" = r."id" AND (s."amount_vnd" <> r."amount_vnd" OR bt."amount_vnd" <> r."amount_vnd"
        OR EXISTS (SELECT 1 FROM "payment_allocations" pa WHERE pa."bank_transaction_id" = bt."id")
        OR EXISTS (SELECT 1 FROM "bank_transaction_dispositions" d WHERE d."bank_transaction_id" = bt."id" AND d."superseded_at" IS NULL))
    ) THEN
      RAISE EXCEPTION 'refund_unallocated_invalid';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM "refund_sources" s
    WHERE s."refund_id" = r."id" AND NOT EXISTS (
      SELECT 1 FROM "payment_allocations" pa WHERE pa."bank_transaction_id" = s."bank_transaction_id" AND pa."order_id" = r."order_id")
  ) THEN
    RAISE EXCEPTION 'refund_source_not_of_order';
  END IF;
  IF (SELECT coalesce(sum("amount_vnd"), 0) FROM "refund_sources" WHERE "refund_id" = r."id") <> r."amount_vnd" THEN
    RAISE EXCEPTION 'refund_sources_total_mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "refund_sources" s JOIN "bank_transactions" bt ON bt."id" = s."bank_transaction_id"
    WHERE s."refund_id" = r."id" AND bt."amount_vnd" < (
      SELECT sum(s2."amount_vnd") FROM "refund_sources" s2 JOIN "refunds" r2 ON r2."id" = s2."refund_id"
      WHERE s2."bank_transaction_id" = bt."id" AND r2."status" NOT IN ('failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'refund_exceeds_transaction';
  END IF;
  IF r."kind" = 'full' AND r."amount_vnd" <> (SELECT "amount_due_vnd" FROM "orders" WHERE "id" = r."order_id") THEN
    RAISE EXCEPTION 'refund_full_amount_mismatch';
  END IF;
  IF r."kind" = 'excess' AND (
    SELECT coalesce(sum("amount_vnd"), 0) FROM "refunds"
    WHERE "order_id" = r."order_id" AND "kind" = 'excess' AND "status" NOT IN ('failed', 'cancelled')
  ) > (
    SELECT coalesce(sum(pa."amount_vnd"), 0) FROM "payment_allocations" pa WHERE pa."order_id" = r."order_id"
  ) - (SELECT "amount_due_vnd" FROM "orders" WHERE "id" = r."order_id") THEN
    RAISE EXCEPTION 'refund_excess_too_large';
  END IF;
  RETURN NULL;
END $$;
