#!/bin/bash
# Thử khôi phục một bản sao lưu trên Postgres tạm, không đụng hệ thống đang chạy, không mở cổng nào.
#   deploy/restore-drill.sh <thư mục hoặc volume sao lưu> <thư mục khóa> [tên bản; mặc định bản mới nhất] [--require-complete]
# Chạy được trên máy bất kỳ có Docker và image worker (IMAGE=marine-english-worker:<tag>). Mã thoát khác 0 = không khôi phục được.
set -euo pipefail
BACKUPS="${1:?thư mục sao lưu}"; KEYS="${2:?thư mục khóa}"; SET="${3:-}"; EXTRA="${4:-}"
IMAGE="${IMAGE:-marine-english-worker:${IMAGE_TAG:-local}}"
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
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -d drill >/dev/null 2>&1 && break; sleep 1; done
# pg_isready trả lời cả lúc initdb chạy server tạm: chờ thêm cho tới khi vai trò đã có.
for _ in $(seq 1 30); do docker exec -e PGPASSWORD="$MIG" "$PG" psql -h 127.0.0.1 -U me_migrator -d drill -c "select 1" >/dev/null 2>&1 && break; sleep 1; done

if [ -z "$SET" ]; then
  SET="$(docker run --rm -v "$BACKUPS:/backup:ro" --entrypoint sh "$IMAGE" -c 'ls /backup/db | sort | tail -1')"
fi
echo "Thử khôi phục bản $SET"
docker run --rm --network "$NET" --tmpfs /restore-media:uid=1000,gid=1000 \
  -v "$BACKUPS:/backup:ro" -v "$KEYS:/keys:ro" "$IMAGE" \
  node deploy/restore.mjs --set "/backup/db/$SET" --store /backup/media-store --keys /keys --media-root /restore-media \
  --db "postgresql://me_migrator:$MIG@$PG:5432/drill" --app-db "postgresql://me_app:$APP@$PG:5432/drill" $EXTRA
