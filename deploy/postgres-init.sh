#!/bin/bash
# Chạy một lần khi volume Postgres còn trống. Mật khẩu lấy từ biến môi trường, không có giá trị mặc định.
set -euo pipefail
: "${ME_MIGRATOR_PASSWORD:?}" "${ME_APP_PASSWORD:?}" "${ME_BACKUP_PASSWORD:?}" "${ME_DB_NAME:?}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v migrator_pw="$ME_MIGRATOR_PASSWORD" -v app_pw="$ME_APP_PASSWORD" -v backup_pw="$ME_BACKUP_PASSWORD" -v db="$ME_DB_NAME" <<'SQL'
CREATE ROLE me_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE me_app LOGIN PASSWORD :'app_pw';
CREATE ROLE me_backup LOGIN PASSWORD :'backup_pw';
GRANT pg_read_all_data TO me_backup;
CREATE DATABASE :"db" OWNER me_migrator;
GRANT CONNECT ON DATABASE :"db" TO me_app, me_backup;
REVOKE CONNECT, TEMPORARY ON DATABASE :"db" FROM PUBLIC;
SQL
