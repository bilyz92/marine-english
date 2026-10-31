# Một Dockerfile, hai đích: `app` (Next.js standalone) và `worker` (tiến trình nền, cũng chạy migrate).
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Khóa công khai kiểm giấy phép offline được nhúng vào mã trình duyệt lúc build (pnpm cli license:public-keys).
ARG NEXT_PUBLIC_LICENSE_PUBLIC_KEYS=""
ENV NEXT_PUBLIC_LICENSE_PUBLIC_KEYS=$NEXT_PUBLIC_LICENSE_PUBLIC_KEYS NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-bookworm-slim AS app
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Volume media mới được Docker tạo với quyền của thư mục này; không có thì thuộc root và app không ghi được.
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.js"]

FROM node:24-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/prisma.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
RUN mkdir -p /data/media && chown node:node /data/media
USER node
# Worker ghi tệp nhịp tim sau mỗi lượt; quá 2 phút không có thì hiện unhealthy (chỉ để quan sát, Docker không tự khởi động lại vì việc này).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const s=require('fs').statSync('/tmp/worker-heartbeat');process.exit(Date.now()-s.mtimeMs<120000?0:1)"
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./src/worker/alias-loader.mjs", "src/worker/worker.ts"]
