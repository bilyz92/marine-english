-- Bài video (docs/superpowers/plans/2026-11-12-video-lessons.md): tệp video gắn vào phiên bản bài với vai 'video', tối đa 300 MB.
-- Chỉ nới ràng buộc (dữ liệu cũ vẫn thỏa) và thêm một ràng buộc mới mà dữ liệu cũ thỏa (chưa có tệp video nào).
ALTER TABLE "lesson_version_assets" DROP CONSTRAINT "lesson_version_assets_role_check";
ALTER TABLE "lesson_version_assets" ADD CONSTRAINT "lesson_version_assets_role_check"
  CHECK ("role" IN ('audio', 'image', 'attachment', 'video'));
ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_bytes_check";
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_bytes_check" CHECK ("bytes" > 0 AND "bytes" <= 314572800);
-- Tệp video luôn được bảo vệ: chỉ tải qua API có kiểm quyền, không bao giờ có đường dẫn công khai.
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_video_protected" CHECK ("mime" NOT LIKE 'video/%' OR "visibility" = 'protected');
