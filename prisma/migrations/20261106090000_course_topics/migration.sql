-- Giao diện v2 (06/11/2026): danh sách bài chia theo chủ đề của học liệu (catalog.modules, ví dụ A1 "Học vấn và mục tiêu nghề nghiệp").
-- Bộ nhập ghi [{id, titleVi, titleEn}] theo thứ tự, chỉ chủ đề có bài trong khóa; khóa soạn trên web hay bộ câu hỏi Word thì rỗng.
-- Chỉ thêm cột có mặc định, không đổi dữ liệu cũ.
ALTER TABLE "courses" ADD COLUMN "topics" JSONB NOT NULL DEFAULT '[]';
GRANT UPDATE ("topics") ON "courses" TO me_app;
