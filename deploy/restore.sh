#!/bin/bash
# Khôi phục thật lên hệ thống mới dựng (DB và volume media còn trống), dùng docker-compose.prod.yml.
#   deploy/restore.sh <tệp env> <thư mục hoặc volume sao lưu> <thư mục khóa> [tên bản; mặc định bản mới nhất]
# Trước đó: dựng Postgres bằng `docker compose ... up -d postgres` (tạo vai trò và DB trống), CHƯA chạy migrate, app, worker.
# Sau đó: `docker compose ... up -d` như bình thường; migrate thấy DB đã ở đúng phiên bản thì không làm gì.
# Đặt COMPOSE_PROJECT_NAME giống lúc dựng stack (mặc định là tên thư mục mã nguồn).
set -euo pipefail
ENV_FILE="${1:?tệp env}"; BACKUPS="${2:?thư mục sao lưu}"; KEYS="${3:?thư mục khóa}"; SET="${4:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.prod.yml" --env-file "$ENV_FILE")
set -a; . "$ENV_FILE"; set +a
if [ -z "$SET" ]; then
  SET="$("${COMPOSE[@]}" run --rm --no-deps -v "$BACKUPS:/backup:ro" --entrypoint sh worker -c 'ls /backup/db | sort | tail -1')"
fi
echo "Khôi phục bản $SET"
"${COMPOSE[@]}" run --rm --no-deps -v "$BACKUPS:/backup:ro" -v "$KEYS:/keys:ro" worker \
  node deploy/restore.mjs --set "/backup/db/$SET" --store /backup/media-store --keys /keys --media-root /data/media \
  --db "postgresql://me_migrator:$ME_MIGRATOR_PASSWORD@postgres:5432/$ME_DB_NAME" \
  --app-db "postgresql://me_app:$ME_APP_PASSWORD@postgres:5432/$ME_DB_NAME"
