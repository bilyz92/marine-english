-- Bằng chứng người mua đã đồng ý điều khoản: bảng riêng, chỉ thêm (orders là ảnh chụp bất biến, không thêm cột sửa được).
CREATE TABLE "order_terms_acceptances" (
  "order_id" UUID NOT NULL PRIMARY KEY REFERENCES "orders"("id") ON DELETE RESTRICT,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "terms_version" TEXT NOT NULL CHECK ("terms_version" <> ''),
  "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE TRIGGER "order_terms_acceptances_immutable" BEFORE UPDATE OR DELETE ON "order_terms_acceptances"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
GRANT SELECT, INSERT ON "order_terms_acceptances" TO me_app;
