-- Chủ tải và gỡ file ghi âm cho từng bài trên trang quản trị (05/11/2026).
-- Gỡ = xóa dòng gắn tệp vào phiên bản bài (tệp và media_assets vẫn giữ, bất biến); sửa dòng vẫn bị cấm.
DROP TRIGGER "lesson_version_assets_immutable" ON "lesson_version_assets";
CREATE TRIGGER "lesson_version_assets_no_update" BEFORE UPDATE ON "lesson_version_assets"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
GRANT DELETE ON "lesson_version_assets" TO me_app;
