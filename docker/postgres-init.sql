-- Chỉ dùng cho dev/test cục bộ. Mật khẩu ở đây không bao giờ dùng cho production.
CREATE ROLE me_migrator LOGIN PASSWORD 'me_migrator_dev' CREATEDB;
CREATE ROLE me_app LOGIN PASSWORD 'me_app_dev';
CREATE ROLE me_other LOGIN PASSWORD 'me_other_dev';
-- Sao lưu: chỉ đọc mọi bảng (cả bảng tạo sau) qua vai trò có sẵn của Postgres; không ghi, không DDL.
CREATE ROLE me_backup LOGIN PASSWORD 'me_backup_dev';
GRANT pg_read_all_data TO me_backup;

CREATE DATABASE me_dev OWNER me_migrator;
CREATE DATABASE me_test OWNER me_migrator;
CREATE DATABASE me_shadow OWNER me_migrator;

GRANT CONNECT ON DATABASE me_dev TO me_app, me_backup;
GRANT CONNECT ON DATABASE me_test TO me_app, me_other, me_backup;
