-- Chủ thêm/sửa nội dung trên web (docs/superpowers/plans/2026-11-02-content-authoring.md).
-- Phiên bản vẫn bất biến (trigger forbid_mutation); app chỉ được THÊM dòng và trỏ khóa sang phiên bản mới.
GRANT INSERT ON "lessons", "lesson_versions", "course_versions", "course_version_lessons", "courses" TO me_app;
GRANT UPDATE ("title_vi", "title_en", "current_version_id", "updated_at") ON "courses" TO me_app;
