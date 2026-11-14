-- Danh mục khóa học hai cấp (chủ 14/11/2026, docs/superpowers/plans/2026-11-14-course-categories.md): parent_id null = danh mục,
-- có parent_id = danh mục con, không có cấp 3. courses.category_id null = "Khóa khác". Chỉ thêm bảng và một cột null.
CREATE TABLE "course_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "parent_id" UUID NULL REFERENCES "course_categories"("id") ON DELETE RESTRICT,
  "seed_key" TEXT NULL UNIQUE,
  "title_vi" TEXT NOT NULL CHECK (char_length(btrim("title_vi")) BETWEEN 1 AND 80),
  "title_en" TEXT NULL CHECK ("title_en" IS NULL OR char_length(btrim("title_en")) BETWEEN 1 AND 80),
  "image_asset_id" UUID NULL REFERENCES "media_assets"("id") ON DELETE RESTRICT,
  "position" INT NOT NULL CHECK ("position" > 0),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- Cha null là một nhóm anh em chung: ràng buộc trên cột sinh (khác chỉ mục biểu thức) nên hoãn được khi hoán vị.
  "parent_key" UUID GENERATED ALWAYS AS (COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  "name_key" TEXT GENERATED ALWAYS AS (lower(regexp_replace(btrim("title_vi"), '\s+', ' ', 'g'))) STORED,
  CONSTRAINT "course_categories_position_key" UNIQUE ("parent_key", "position") DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT "course_categories_name_key" UNIQUE ("parent_key", "name_key")
);
CREATE INDEX "course_categories_image_idx" ON "course_categories" ("image_asset_id");

-- Hai cấp tối đa; ảnh chỉ là tệp công khai.
CREATE FUNCTION course_categories_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id
       OR EXISTS (SELECT 1 FROM course_categories WHERE id = NEW.parent_id AND parent_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM course_categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'category_depth' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.image_asset_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM media_assets WHERE id = NEW.image_asset_id AND visibility = 'public') THEN
    RAISE EXCEPTION 'category_image_not_public' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER course_categories_guard BEFORE INSERT OR UPDATE OF "parent_id", "image_asset_id" ON "course_categories"
  FOR EACH ROW EXECUTE FUNCTION course_categories_guard();

ALTER TABLE "courses" ADD COLUMN "category_id" UUID NULL REFERENCES "course_categories"("id") ON DELETE RESTRICT;
CREATE INDEX "courses_category_idx" ON "courses" ("category_id");

GRANT SELECT, INSERT, UPDATE, DELETE ON "course_categories" TO me_app;
GRANT UPDATE ("category_id") ON "courses" TO me_app;
