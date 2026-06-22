# =============================================================================
# El Dorado — 单镜像构建（HTTP 静态 + WebSocket 单进程，端口 3000）
# 构建上下文：仓库根
# 用法：
#   docker build -t el-dorado .
# 跟 double-jump 同一套部署模板，目录布局改为 packages/*；推送到
# ghcr.io/donle/el-dorado（不再共用 double-jump 的镜像名）。
# =============================================================================

# ---------- Stage 1: build client ----------
FROM node:22-alpine AS client-build
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /build

# 京东云 2GB 内存 + 容器内可用更少。vite build 时 Node 默认 1.5GB heap 会 OOM，
# 把 heap 限到 1GB，足够 vite + esbuild 同时跑。
ENV NODE_OPTIONS=--max-old-space-size=1024

# workspace 元信息 + 子包 manifest
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/client/package.json ./packages/client/
COPY packages/core/package.json ./packages/core/

# core 源码（client 通过 workspace:* 依赖 core）
COPY packages/core/ ./packages/core/
# client 源码（src、public、vite.config、tsconfig）
COPY packages/client/ ./packages/client/

# 只装 client 的依赖（--filter @eldorado/client... 拉取它的传递依赖）
# --ignore-scripts 避免 pnpm 10+ 拦截未声明的 install 脚本（esbuild 手动跑）
RUN pnpm install --no-lockfile --filter @eldorado/client... \
    --config.strict-dep-builds=false --ignore-scripts 2>&1 | tail -20

# vite 依赖 esbuild 原生二进制，--ignore-scripts 跳过了它，手动跑 install.js
RUN cd /build/node_modules/.pnpm/esbuild@*/node_modules/esbuild && node install.js

# 单独跑 client 的 build
RUN pnpm --filter @eldorado/client run build

# ---------- Stage 2: server deps ----------
FROM node:22-alpine AS server-deps
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /build

ENV NODE_OPTIONS=--max-old-space-size=1024
# 显式把 pnpm store 放到 /tmp，避开默认路径的写权限问题
ENV PNPM_HOME=/tmp/pnpm-home
ENV PNPM_STORE_DIR=/tmp/pnpm-store

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/server/package.json ./packages/server/
COPY packages/core/package.json ./packages/core/

COPY packages/server/ ./packages/server/
COPY packages/core/ ./packages/core/

RUN pnpm install --no-lockfile --filter @eldorado/server... \
    --config.strict-dep-builds=false --ignore-scripts 2>&1 | tail -10

# ---------- Stage 3: runtime ----------
FROM node:22-alpine
WORKDIR /app

# dist 放 /app/packages/client/dist —— 与 server/src/index.ts 中
#   new URL('../../client/dist', import.meta.url)
# 在 Docker 内解析结果一致。dev 与 prod 同一份路径代码，无 if 分支。
COPY --from=client-build /build/packages/client/dist /app/packages/client/dist
COPY --from=server-deps /build/packages/server /app/packages/server
COPY --from=server-deps /build/packages/core /app/packages/core
# pnpm 把 node_modules 集中放在 workspace 根 /build/node_modules，
# 整个搬过来给 runtime 用
COPY --from=server-deps /build/node_modules /app/node_modules

WORKDIR /app/packages/server
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NODE_ENV=production

CMD ["node", "--import", "tsx", "src/index.ts"]