#!/bin/bash
# Khôi phục thật lên hệ thống mới dựng (DB và volume media còn trống), dùng docker-compose.prod.yml.
#   deploy/restore.sh <tệp env> <thư mục hoặc volume sao lưu> <thư mục khóa> [tên bản] [--require-complete]
# Trước đó: dựng Postgres bằng `docker compose ... up -d postgres` (tạo vai trò và DB trống), CHƯA chạy migrate, app, worker.
# Sau đó: `docker compose ... up -d` như bình thường; migrate thấy DB đã ở đúng phiên bản thì không làm gì.
# Đặt COMPOSE_PROJECT_NAME giống lúc dựng stack (mặc định là tên thư mục mã nguồn).
set -euo pipefail
POS=(); REQUIRE=""
for a in "$@"; do case "$a" in --require-complete) REQUIRE="--require-complete" ;; --*) echo "tham số lạ: $a"; exit 2 ;; *) POS+=("$a") ;; esac; done
ENV_FILE="${POS[0]:?tệp env}"; BACKUPS="${POS[1]:?thư mục sao lưu}"; KEYS="${POS[2]:?thư mục khóa}"; SET="${POS[3]:-}"
[ -d "$BACKUPS" ] && BACKUPS="$(realpath "$BACKUPS")"
KEYS="$(realpath "$KEYS")"
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.prod.yml" --env-file "$ENV_FILE")
set -a; . "$ENV_FILE"; set +a
# Máy mới chưa có image worker (dịch vụ worker không tự build): build từ mã nguồn hiện có.
"${COMPOSE[@]}" build migrate
if [ -z "$SET" ]; then
  SET="$("${COMPOSE[@]}" run --rm --no-deps -v "$BACKUPS:/backup:ro" --entrypoint sh worker -c \
    'for d in $(ls /backup/db | sort -r); do if [ -z "$1" ] || [ -f "/backup/db/$d/COMPLETE" ]; then echo "$d"; break; fi; done' sh "$REQUIRE")"
  [ -n "$SET" ] || { echo "Không có bản sao lưu phù hợp"; exit 1; }
fi
echo "Khôi phục bản $SET"
# Mật khẩu qua biến môi trường (-e TÊN lấy giá trị từ shell), không nằm trong tham số dòng lệnh.
export RESTORE_DB_URL="postgresql://me_migrator:$ME_MIGRATOR_PASSWORD@postgres:5432/$ME_DB_NAME"
export RESTORE_APP_DB_URL="postgresql://me_app:$ME_APP_PASSWORD@postgres:5432/$ME_DB_NAME"
"${COMPOSE[@]}" run --rm --no-deps -e RESTORE_DB_URL -e RESTORE_APP_DB_URL -v "$BACKUPS:/backup:ro" -v "$KEYS:/keys:ro" worker \
  node deploy/restore.mjs --set "/backup/db/$SET" --store /backup/media-store --keys /keys --media-root /data/media $REQUIRE
