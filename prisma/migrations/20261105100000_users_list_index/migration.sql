-- Danh sách học viên trên trang quản trị: mới nhất trước, bỏ tài khoản đã gộp (05/11/2026).
CREATE INDEX "users_unmerged_created_id_idx" ON "users" ("created_at" DESC, "id" DESC) WHERE "merged_into_id" IS NULL;
