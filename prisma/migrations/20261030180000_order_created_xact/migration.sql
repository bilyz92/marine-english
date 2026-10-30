-- xmin đổi khi dòng đơn bị cập nhật nên không niêm phong được ảnh chụp đơn. Dùng mã transaction tạo đơn, cố định từ lúc INSERT.
ALTER TABLE "orders" ADD COLUMN "created_xact" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- Luôn do DB đặt, không nhận giá trị từ câu lệnh INSERT.
CREATE FUNCTION "orders_set_created_xact"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."created_xact" := pg_current_xact_id();
  RETURN NEW;
END $$;
CREATE TRIGGER "orders_set_created_xact" BEFORE INSERT ON "orders" FOR EACH ROW EXECUTE FUNCTION "orders_set_created_xact"();

CREATE OR REPLACE FUNCTION "orders_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."code" <> OLD."code" OR NEW."user_id" <> OLD."user_id" OR NEW."created_at" <> OLD."created_at"
     OR NEW."expires_at" <> OLD."expires_at" OR NEW."amount_due_vnd" <> OLD."amount_due_vnd"
     OR NEW."currency" <> OLD."currency" OR NEW."refund_policy_version" <> OLD."refund_policy_version"
     OR NEW."created_xact" <> OLD."created_xact" THEN
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

CREATE OR REPLACE FUNCTION "order_items_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT "created_xact" FROM "orders" WHERE "id" = NEW."order_id") <> pg_current_xact_id() THEN
    RAISE EXCEPTION 'order_items_after_creation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "course_versions" WHERE "id" = NEW."course_version_id" AND "course_id" = NEW."course_id") THEN
    RAISE EXCEPTION 'order_item_version_mismatch';
  END IF;
  RETURN NEW;
END $$;
