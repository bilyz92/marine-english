-- Mô tả khóa học (chủ 26/11/2026): chữ thuần, hiện trên trang khóa công khai; null = chưa có.
ALTER TABLE "courses" ADD COLUMN "description" TEXT
  CHECK ("description" IS NULL OR (char_length("description") BETWEEN 1 AND 8000));
GRANT UPDATE ("description") ON "courses" TO me_app;
