#!/bin/bash
# Chạy lệnh CLI của dự án trong container worker đang chạy (đã có SESSION_KEY_ADMIN, APP_ORIGIN...):
#   deploy/cli.sh <tệp env> admin:login-link <email>
#   deploy/cli.sh <tệp env> admin:bootstrap <email>
# Máy có nginx sẵn: ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml như deploy.sh.
# Chuỗi kết nối me_migrator lấy từ cấu hình Compose đã dựng (Compose tự đọc tệp env), chỉ chuyển vào container theo tên biến,
# không nằm trên dòng lệnh.
set -euo pipefail
ENV_FILE="${1:?tệp env}"; shift
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.prod.yml")
if [ -n "${ME_COMPOSE_OVERRIDE:-}" ]; then COMPOSE+=(-f "$HERE/../$ME_COMPOSE_OVERRIDE"); fi
COMPOSE+=(--env-file "$ENV_FILE")
MIGRATOR_DATABASE_URL="$("${COMPOSE[@]}" config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["migrate"]["environment"]["MIGRATOR_DATABASE_URL"])')"
export MIGRATOR_DATABASE_URL
WORKER="$("${COMPOSE[@]}" ps -q worker)"
[ -n "$WORKER" ] || { echo "Worker không chạy"; exit 2; }
exec docker exec -e MIGRATOR_DATABASE_URL "$WORKER" \
  node --experimental-transform-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --import ./src/worker/alias-loader.mjs src/worker/cli.ts "$@"
