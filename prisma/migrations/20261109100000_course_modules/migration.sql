-- Module khóa học (chủ 08/11/2026, docs/superpowers/plans/2026-11-08-course-modules.md): chủ tự tạo, đặt tên, sắp thứ tự module
-- của từng khóa và xếp bài vào module. Không theo phiên bản: xếp theo lessons.id nên sửa bài hay nhập lại học liệu vẫn giữ.
-- Chỉ thêm bảng.
CREATE TABLE "course_modules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "course_id" UUID NOT NULL REFERENCES "courses"("id") ON DELETE RESTRICT,
  "title_vi" TEXT NOT NULL CHECK (char_length(btrim("title_vi")) BETWEEN 1 AND 120),
  "position" INT NOT NULL CHECK ("position" >= 1),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "course_modules_course_position_key" UNIQUE ("course_id", "position") DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "course_modules_course_id_id_key" UNIQUE ("course_id", "id")
);

CREATE TABLE "course_lesson_modules" (
  "course_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL REFERENCES "lessons"("id") ON DELETE RESTRICT,
  "module_id" UUID NOT NULL,
  PRIMARY KEY ("course_id", "lesson_id"),
  -- Module phải thuộc đúng khóa đó.
  FOREIGN KEY ("course_id", "module_id") REFERENCES "course_modules" ("course_id", "id") ON DELETE RESTRICT
);
CREATE INDEX "course_lesson_modules_module_idx" ON "course_lesson_modules" ("module_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "course_modules", "course_lesson_modules" TO me_app;
