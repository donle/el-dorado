#!/usr/bin/env bash
# =============================================================================
# El Dorado — 服务器端部署脚本
# 用法：
#   ./deploy.sh                          # 拉取 ghcr.io 上的 latest 镜像
#   ./deploy.sh local                    # 用本地 Dockerfile 构建（不上 registry）
#   ./deploy.sh v1.2.3                   # 拉取指定 tag
# 配置（任选其一，优先级从高到低）：
#   1. 显式环境变量 IMAGE / CONTAINER / PORT
#   2. 当前目录的 .env 文件
#   3. 内置默认值
# 独立镜像 ghcr.io/donle/el-dorado，部署时清理之前 double-jump 的旧容器/镜像
# =============================================================================

set -euo pipefail

# 读 .env（如果存在）
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# ---- 配置 ----
IMAGE="${IMAGE:-ghcr.io/donle/el-dorado}"
CONTAINER="${CONTAINER:-el-dorado}"
PORT="${PORT:-3000}"
TAG="${1:-latest}"

# ---- 清理旧容器（double-jump），避免端口冲突 ----
echo "==> 清理旧容器 double-jump（如果存在）"
if docker ps -a --format '{{.Names}}' | grep -qx 'double-jump'; then
  docker stop double-jump >/dev/null 2>&1 || true
  docker rm double-jump >/dev/null 2>&1 || true
  echo "    ✓ 已停掉并删除 double-jump 容器"
fi

# ---- 清理旧镜像（ghcr.io/donle/double-jump），释放磁盘 ----
echo "==> 清理旧镜像 ghcr.io/donle/double-jump（如果存在）"
old_images=$(docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' \
  | awk '$1 ~ /^ghcr\.io\/donle\/double-jump(:.*)?$/ {print $2}' || true)
if [[ -n "$old_images" ]]; then
  echo "$old_images" | xargs docker image rm -f >/dev/null 2>&1 || true
  echo "    ✓ 已删除旧镜像"
fi

if [[ "$TAG" == "local" ]]; then
  TAG="local-$(date +%Y%m%d-%H%M%S)"
  echo "==> [local] 在服务器上 build 镜像：$IMAGE:$TAG"
  # Dockerfile 用了 BuildKit 语法（--mount=type=cache + # syntax=docker/dockerfile:1.4）。
  # Docker 20.10 默认未启 BuildKit，必须显式开，否则 --mount=type=cache 会被忽略并 EPERM。
  DOCKER_BUILDKIT=1 docker build -t "$IMAGE:$TAG" -t "$IMAGE:latest" .
else
  echo "==> 拉取镜像：$IMAGE:$TAG"
  docker pull "$IMAGE:$TAG"
  # 顺便打一个 latest 标签，方便后续滚动更新
  docker tag "$IMAGE:$TAG" "$IMAGE:latest"
fi

echo "==> 停掉旧容器（$CONTAINER，如果存在）"
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  docker stop "$CONTAINER" >/dev/null 2>&1 || true
  docker rm "$CONTAINER" >/dev/null 2>&1 || true
fi

echo "==> 起新容器"
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:3000" \
  -e "PORT=3000" \
  -e "HOST=0.0.0.0" \
  -e "NODE_ENV=production" \
  "$IMAGE:$TAG"

echo "==> 等 3 秒让服务起来"
sleep 3

echo "==> 容器状态"
docker ps --filter "name=$CONTAINER" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

echo "==> 健康检查"
if curl -sf -o /dev/null -m 5 "http://127.0.0.1:${PORT}/"; then
  echo "  ✓ HTTP 200，部署成功"
else
  echo "  ✗ HTTP 不通，查看日志："
  docker logs --tail 50 "$CONTAINER"
  exit 1
fi

echo "==> 清理悬空镜像（节省磁盘）"
docker image prune -f >/dev/null 2>&1 || true

echo ""
echo "✓ 部署完成。日志：docker logs -f $CONTAINER"