#!/bin/bash
# Thử khôi phục một bản sao lưu trên Postgres tạm, không đụng hệ thống đang chạy, không mở cổng nào.
#   deploy/restore-drill.sh <thư mục hoặc volume sao lưu> <thư mục khóa> [tên bản] [--require-complete]
# Mặc định bản mới nhất; với --require-complete là bản mới nhất có COMPLETE (bản tải về từ nơi lưu ngoài).
# Cần Docker và image worker (IMAGE, mặc định marine-english-worker:local; build: docker build --target worker -t marine-english-worker:local .).
# Tệp khóa phải đọc được với uid 1000. Mã thoát khác 0 = không khôi phục được.
set -euo pipefail
POS=(); REQUIRE=""
for a in "$@"; do case "$a" in --require-complete) REQUIRE="--require-complete" ;; --*) echo "tham số lạ: $a"; exit 2 ;; *) POS+=("$a") ;; esac; done
BACKUPS="${POS[0]:?thư mục sao lưu}"; KEYS="${POS[1]:?thư mục khóa}"; SET="${POS[2]:-}"
# Đường dẫn tương đối bị Docker hiểu là tên volume: đổi sang tuyệt đối nếu là thư mục có thật.
[ -d "$BACKUPS" ] && BACKUPS="$(realpath "$BACKUPS")"
KEYS="$(realpath "$KEYS")"
IMAGE="${IMAGE:-marine-english-worker:${IMAGE_TAG:-local}}"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "Chưa có image $IMAGE: docker build --target worker -t $IMAGE ."; exit 2; }
RUN="drill-$(date +%s)-$RANDOM"
NET="$RUN-net"; PG="$RUN-pg"
PGPW="$(openssl rand -hex 16)"; MIG="$(openssl rand -hex 16)"; APP="$(openssl rand -hex 16)"; BAK="$(openssl rand -hex 16)"
cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
HERE="$(cd "$(dirname "$0")" && pwd)"

docker network create --internal "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_PASSWORD="$PGPW" -e ME_DB_NAME=drill -e ME_MIGRATOR_PASSWORD="$MIG" -e ME_APP_PASSWORD="$APP" -e ME_BACKUP_PASSWORD="$BAK" \
  -v "$HERE/postgres-init.sh:/docker-entrypoint-initdb.d/01-roles.sh:ro" postgres:16 >/dev/null
# Kiểm qua TCP: lúc initdb, server tạm chỉ nghe socket nên pg_isready qua socket báo sẵn sàng quá sớm.
for _ in $(seq 1 90); do docker exec -e PGPASSWORD="$MIG" "$PG" psql -h 127.0.0.1 -U me_migrator -d drill -c "select 1" >/dev/null 2>&1 && break; sleep 1; done

if [ -z "$SET" ]; then
  SET="$(docker run --rm -v "$BACKUPS:/backup:ro" --entrypoint sh "$IMAGE" -c \
    'for d in $(ls /backup/db | sort -r); do if [ -z "$1" ] || [ -f "/backup/db/$d/COMPLETE" ]; then echo "$d"; break; fi; done' sh "$REQUIRE")"
  [ -n "$SET" ] || { echo "Không có bản sao lưu phù hợp"; exit 1; }
fi
echo "Thử khôi phục bản $SET"
export RESTORE_DB_URL="postgresql://me_migrator:$MIG@$PG:5432/drill" RESTORE_APP_DB_URL="postgresql://me_app:$APP@$PG:5432/drill"
docker run --rm --network "$NET" --tmpfs /restore-media:uid=1000,gid=1000 -e RESTORE_DB_URL -e RESTORE_APP_DB_URL \
  -v "$BACKUPS:/backup:ro" -v "$KEYS:/keys:ro" "$IMAGE" \
  node deploy/restore.mjs --set "/backup/db/$SET" --store /backup/media-store --keys /keys --media-root /restore-media $REQUIRE
