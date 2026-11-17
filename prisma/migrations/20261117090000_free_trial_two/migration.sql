-- Chủ 17/11/2026: mỗi khóa chỉ còn 2 bài học thử (trước là 3). Các phiên bản khóa đã có: bỏ cờ học thử từ bài thứ 3 trở đi.
-- Chỉ tắt, không bật thêm bài nào. Nội dung bài và mã băm không đổi, nên máy học viên đã tải không phải tải lại.
-- course_version_lessons là bảng bất biến: tắt trigger bảo vệ trong đúng migration này rồi bật lại, cả ba câu trong một giao dịch
-- để lỗi giữa chừng không để trigger bị tắt.
BEGIN;
ALTER TABLE "course_version_lessons" DISABLE TRIGGER "course_version_lessons_immutable";
UPDATE "course_version_lessons" SET "is_free_trial" = false WHERE "is_free_trial" AND "position" > 2;
ALTER TABLE "course_version_lessons" ENABLE TRIGGER "course_version_lessons_immutable";
COMMIT;
