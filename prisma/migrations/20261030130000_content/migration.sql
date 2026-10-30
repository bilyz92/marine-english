-- Nội dung có phiên bản. Phiên bản khóa/bài là bất biến; khóa chỉ đổi giá, trạng thái và phiên bản hiện hành.

CREATE TABLE "courses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "slug" TEXT NOT NULL UNIQUE,
  "title_vi" TEXT NOT NULL,
  "title_en" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'published', 'archived')),
  "price_vnd" INTEGER CHECK ("price_vnd" > 0),
  "current_version_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "courses_publish_check" CHECK ("status" <> 'published' OR ("price_vnd" IS NOT NULL AND "current_version_id" IS NOT NULL))
);

CREATE TABLE "course_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "course_id" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "content_version" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  UNIQUE ("course_id", "version"),
  UNIQUE ("course_id", "source_hash")
);
ALTER TABLE "courses" ADD CONSTRAINT "courses_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_versions" ADD CONSTRAINT "course_versions_course_id_fkey"
  FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "lessons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "external_id" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE "lesson_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "lesson_id" UUID NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" >= 1),
  "content" JSONB NOT NULL,
  "content_hash" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  UNIQUE ("lesson_id", "version"),
  UNIQUE ("lesson_id", "content_hash")
);
ALTER TABLE "lesson_versions" ADD CONSTRAINT "lesson_versions_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "course_version_lessons" (
  "course_version_id" UUID NOT NULL,
  "lesson_version_id" UUID NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 1),
  "is_free_trial" BOOLEAN NOT NULL,
  PRIMARY KEY ("course_version_id", "position"),
  UNIQUE ("course_version_id", "lesson_version_id")
);
ALTER TABLE "course_version_lessons" ADD CONSTRAINT "course_version_lessons_course_version_id_fkey"
  FOREIGN KEY ("course_version_id") REFERENCES "course_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_version_lessons" ADD CONSTRAINT "course_version_lessons_lesson_version_id_fkey"
  FOREIGN KEY ("lesson_version_id") REFERENCES "lesson_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "course_versions_immutable" BEFORE UPDATE OR DELETE ON "course_versions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "lesson_versions_immutable" BEFORE UPDATE OR DELETE ON "lesson_versions"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();
CREATE TRIGGER "course_version_lessons_immutable" BEFORE UPDATE OR DELETE ON "course_version_lessons"
  FOR EACH ROW EXECUTE FUNCTION "forbid_mutation"();

GRANT SELECT ON "courses", "course_versions", "lessons", "lesson_versions", "course_version_lessons" TO me_app;
GRANT UPDATE ("price_vnd", "status", "updated_at") ON "courses" TO me_app;
