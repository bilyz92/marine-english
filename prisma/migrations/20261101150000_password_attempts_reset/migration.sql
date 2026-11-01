-- D2: lượt thử mã đặt lại mật khẩu (giới hạn theo IP trước khi băm) dùng chung bảng lượt thử.
ALTER TABLE "password_attempts" DROP CONSTRAINT "password_attempts_kind_check";
ALTER TABLE "password_attempts" ADD CONSTRAINT "password_attempts_kind_check" CHECK ("kind" IN ('login', 'current', 'register', 'reset'));
