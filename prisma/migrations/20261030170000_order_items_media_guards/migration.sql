-- Sửa sau review Codex vòng 1.

-- Ảnh chụp đơn: dòng hàng chỉ được thêm trong chính transaction tạo đơn, mỗi khóa một dòng, phiên bản phải thuộc khóa;
-- tổng giá được kiểm lại khi commit cả với dòng hàng chèn sau.
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_course_key" UNIQUE ("order_id", "course_id");

CREATE FUNCTION "order_items_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT xmin FROM "orders" WHERE "id" = NEW."order_id") <> pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'order_items_after_creation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "course_versions" WHERE "id" = NEW."course_version_id" AND "course_id" = NEW."course_id") THEN
    RAISE EXCEPTION 'order_item_version_mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "order_items_guard" BEFORE INSERT ON "order_items" FOR EACH ROW EXECUTE FUNCTION "order_items_guard"();

CREATE FUNCTION "order_items_total_recheck"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT coalesce(sum("final_price_vnd"), 0) FROM "order_items" WHERE "order_id" = NEW."order_id")
     <> (SELECT "amount_due_vnd" FROM "orders" WHERE "id" = NEW."order_id") THEN
    RAISE EXCEPTION 'order_items_total_mismatch';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "order_items_total" AFTER INSERT ON "order_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "order_items_total_recheck"();

-- Tệp media: cùng nội dung có thể vừa công khai vừa được bảo vệ (hai thư mục khác nhau) — định danh gồm cả visibility.
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_storage_key_key";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_visibility_storage_key_key" UNIQUE ("visibility", "storage_key");
