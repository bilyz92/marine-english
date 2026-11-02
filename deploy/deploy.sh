#!/bin/bash
# Deploy hoặc quay lại một tag:  deploy/deploy.sh <tệp env> <tag> [--skip-build] [--skip-migrate]
#   1. build image app và worker với tag (bỏ qua nếu --skip-build: dùng image đã có, ví dụ khi quay lại)
#   2. migrate bằng me_migrator (migration luôn tương thích ngược một phiên bản nên bản đang chạy vẫn chạy được)
#   3. chạy thử app ứng viên trong mạng nội bộ; không khỏe thì DỪNG, bản đang chạy không bị đụng
#   4. thay app (một máy chủ nên có gián đoạn ngắn), đợi khỏe
#   5. dừng worker cũ (tối đa 60 giây để xong việc và nhả lease) rồi chạy worker mới
# Quay lại bản trước: deploy/deploy.sh <tệp env> <tag cũ> --skip-build --skip-migrate (không đảo migration).
set -euo pipefail
ENV_FILE="${1:?tệp env}"; TAG="${2:?tag}"; shift 2
SKIP_BUILD=0; SKIP_MIGRATE=0
for a in "$@"; do case "$a" in --skip-build) SKIP_BUILD=1 ;; --skip-migrate) SKIP_MIGRATE=1 ;; *) echo "tham số lạ: $a"; exit 2 ;; esac; done
HERE="$(cd "$(dirname "$0")" && pwd)"
export IMAGE_TAG="$TAG"
# Máy đã có nginx (không chạy Caddy): ME_COMPOSE_OVERRIDE=deploy/compose.nginx.yml (đường dẫn tương đối với thư mục gốc dự án).
COMPOSE=(docker compose -f "$HERE/../docker-compose.prod.yml")
if [ -n "${ME_COMPOSE_OVERRIDE:-}" ]; then COMPOSE+=(-f "$HERE/../$ME_COMPOSE_OVERRIDE"); fi
COMPOSE+=(--env-file "$ENV_FILE")
step() { echo "== $(date +%H:%M:%S) $*"; }
wait_healthy() { # <container> <giây>
  for _ in $(seq 1 "$2"); do
    case "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null)" in
      healthy) return 0 ;; exited|dead|unhealthy) return 1 ;;
    esac
    sleep 1
  done
  return 1
}

if [ "$SKIP_BUILD" = 0 ]; then
  step "build $TAG"; "${COMPOSE[@]}" build migrate app
else
  # Không có image của tag thì Compose sẽ build mã nguồn HIỆN TẠI rồi gắn tag cũ: quay lại thành deploy nhầm.
  for image in "marine-english-app:$TAG" "marine-english-worker:$TAG"; do
    docker image inspect "$image" >/dev/null 2>&1 || { echo "Không có image $image trên máy. Dừng."; exit 1; }
  done
fi
if [ "$SKIP_MIGRATE" = 0 ]; then step "migrate"; "${COMPOSE[@]}" run --rm --no-deps migrate; fi

step "chạy thử app ứng viên"
CANDIDATE="$("${COMPOSE[@]}" run -d --no-deps app)"
trap 'docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true' EXIT
if ! wait_healthy "$CANDIDATE" 90; then
  echo "Ứng viên $TAG KHÔNG khỏe. Dừng deploy; bản đang chạy giữ nguyên. Nhật ký ứng viên:"
  docker logs --tail 30 "$CANDIDATE" 2>&1 || true
  exit 1
fi
docker rm -f "$CANDIDATE" >/dev/null; trap - EXIT

step "thay app"
"${COMPOSE[@]}" up -d --no-deps app
APP="$("${COMPOSE[@]}" ps -q app)"
if ! wait_healthy "$APP" 120; then
  echo "App $TAG không khỏe sau khi thay. Quay lại ngay: deploy/deploy.sh $ENV_FILE <tag trước> --skip-build --skip-migrate"
  exit 1
fi

step "thay worker"
"${COMPOSE[@]}" stop -t 60 worker
"${COMPOSE[@]}" up -d --no-deps worker
if ! wait_healthy "$("${COMPOSE[@]}" ps -q worker)" 150; then
  echo "Worker $TAG không khỏe. Xem: docker compose ... logs worker; quay lại: deploy/deploy.sh $ENV_FILE <tag trước> --skip-build --skip-migrate"
  exit 1
fi
# Ghi tag đang chạy vào tệp env, để `docker compose ... up -d` chạy tay sau này dùng đúng bản.
if grep -q '^IMAGE_TAG=' "$ENV_FILE"; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" "$ENV_FILE"; else echo "IMAGE_TAG=$TAG" >> "$ENV_FILE"; fi
step "xong: $TAG"
