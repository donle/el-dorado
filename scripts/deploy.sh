#!/usr/bin/env bash
# =============================================================================
# El Dorado — 一步部署脚本（Git Bash / WSL / macOS / Linux）
#
# 用法：
#   scripts/deploy.sh              推送本地所有未提交修改 + 服务器重建 + 重启
#   scripts/deploy.sh "fix xxx"    同上，commit 信息自定义
#
# 它会做：
#   1. git add -A && commit
#   2. git push origin main
#   3. SSH 到服务器 → 下载 tarball（绕过 github.com 封锁）→ ./deploy.sh local
#
# 前置：
#   - 仓库根目录运行
#   - ssh / git 在 PATH
#   - $HOME/.ssh/double_jump_deploy（或 SSH_KEY_PATH 环境变量）能登录 root@117.72.204.51
#
# 安全：
#   - 用 StrictHostKeyChecking=accept-new（不是 no）。首次连接会接受并存到
#     known_hosts，之后若服务器密钥变了会拒接，避免 MITM。
#   - 远程 tarball 解压用安全 flag（拒 .. 路径、拒越界 symlink）。
#   - .env 备份走 mktemp + 600 + trap，结束后即清。
#
# 关于"为什么不用 git pull"：
#   - 京东云（以及大多数中国云）出口到 github.com 经常被墙 / 抖动
#   - 但 codeload.github.com（Cloudflare CDN 上的 tarball 服务）通常能通
#   - 所以服务器侧用 tarball 下载 + 解压替代 git pull
#   - 代价：服务器上没有 .git 目录（只是部署目标，不需要）
#
# 跟 double-jump 共用同一台服务器（117.72.204.51），但部署目录已切到 /opt/el-dorado，
# 容器名 el-dorado，镜像名 ghcr.io/donle/el-dorado。deploy.sh 会自动清理 double-jump
# 留下的旧容器和镜像。
# =============================================================================

set -euo pipefail

SERVER="${SERVER:-root@117.72.204.51}"
REPO="${REPO:-donle/el-dorado}"   # GitHub user/repo
BRANCH="${BRANCH:-main}"
SSH_KEY="${SSH_KEY_PATH:-$HOME/.ssh/double_jump_deploy}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="$HOME/.ssh/known_hosts")
MSG="${1:-deploy: update}"

# 必须在仓库根
cd "$(git rev-parse --show-toplevel)"

# 早期校验 REPO/BRANCH 形态（防止恶意输入被拼到 shell 命令）
case "$REPO" in
  ''|*[!A-Za-z0-9._/-]*)
    echo "bad REPO: '$REPO'" >&2; exit 1 ;;
esac
case "$BRANCH" in
  ''|*[!A-Za-z0-9._/-]*)
    echo "bad BRANCH: '$BRANCH'" >&2; exit 1 ;;
esac

echo
echo "=== [1/3] git commit + push ==="
echo

git add -A
if git diff --cached --quiet; then
  echo "没有未提交修改，跳过 commit"
else
  git commit -m "$MSG"
fi
git push origin "$BRANCH"

echo
echo "=== [2/3] ssh 到服务器拉 tarball ==="
echo

# 服务器走 codeload.github.com（CDN，国内能通）拉 tarball
# 保留 .env（部署配置）—— 其他覆盖
ssh "${SSH_OPTS[@]}" "$SERVER" bash -s -- "$REPO" "$BRANCH" <<'REMOTE'
set -euo pipefail

REPO="$1"
BRANCH="$2"
DEPLOY_DIR="/opt/el-dorado"
ENV_FILE="$DEPLOY_DIR/.env"

# ---- 二次校验：远程 shell 也是 bash，别信本地 ----
case "$REPO" in
  ''|*[!A-Za-z0-9._/-]*)
    echo "bad REPO: '$REPO'" >&2; exit 1 ;;
esac
case "$BRANCH" in
  ''|*[!A-Za-z0-9._/-]*)
    echo "bad BRANCH: '$BRANCH'" >&2; exit 1 ;;
esac

# ---- 私有的 .env 备份（mktemp + 600 + trap，结束即清） ----
BACKUP=""
cleanup() { [ -n "${BACKUP:-}" ] && [ -f "$BACKUP" ] && rm -f "$BACKUP" || true; }
trap cleanup EXIT

if [ -f "$ENV_FILE" ]; then
  BACKUP=$(mktemp /root/.env.bak.XXXXXX) || { echo "mktemp failed" >&2; exit 1; }
  chmod 600 "$BACKUP"
  cp -p "$ENV_FILE" "$BACKUP"
fi

# ---- 暂存目录：解压到 /root/dj-stage.XXXXXX，校验完再 rsync 到目标 ----
STAGE=$(mktemp -d /root/dj-stage.XXXXXX) || { echo "mktemp -d failed" >&2; exit 1; }
chmod 700 "$STAGE"

# 下载（用 printf 显式 %s 拼接，避免任何 shell 解释）
url=$(printf 'https://codeload.github.com/%s/tar.gz/refs/heads/%s' "$REPO" "$BRANCH")
curl -sSLf -o "$STAGE/repo.tar.gz" "$url"

# ---- 安全解压：拒 owner 转移、拒 ACL/xattr ----
tar --no-same-owner --no-same-permissions --no-acls --no-xattrs \
    -xzf "$STAGE/repo.tar.gz" -C "$STAGE" --strip-components=1

# 拒残留的 '..' 路径
if find "$STAGE" -mindepth 1 \( -name '..' -o -name '*../*' \) -print -quit | grep -q .; then
  echo "tarball contains '..' path components, refusing" >&2; exit 1
fi

# 拒任何绝对路径（兜底 -C 行为。用 %P 输出相对 STAGE 的路径，避免误报 STAGE 本身）
if find "$STAGE" -mindepth 1 -printf '%P\n' | grep -E '^/'; then
  echo "tarball contains absolute paths, refusing" >&2; exit 1
fi

# 拒越界 symlink
badlink=$(find "$STAGE" -type l -printf '%l\n' | grep -E '^/|\.\./' || true)
if [ -n "$badlink" ]; then
  echo "tarball contains escaping symlinks: $badlink" >&2; exit 1
fi

rm -f "$STAGE/repo.tar.gz"

# ---- 原子覆盖：用 cp -a 把 stage 内容铺到 DEPLOY_DIR，保留 .env ----
mkdir -p "$DEPLOY_DIR"
# 删掉 DEPLOY_DIR 里除 .env 以外的所有内容
find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 ! -name '.env' -exec rm -rf {} +
# 覆盖式拷贝（cp -a 保留 mode/owner 但已经用 no-same-owner 不会真改 owner）
cp -a "$STAGE"/. "$DEPLOY_DIR"/

# 恢复 .env（tarball 不会带 .env——它被 .gitignore 了——但 cp 阶段也不会带）
if [ -n "$BACKUP" ] && [ -f "$BACKUP" ]; then
  cp -p "$BACKUP" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# 恢复可执行权限
chmod +x "$DEPLOY_DIR/deploy.sh" "$DEPLOY_DIR/scripts/deploy.sh"

# 清理
rm -rf "$STAGE"
cleanup
trap - EXIT

echo "拉取完成（$REPO @ $BRANCH）"
REMOTE

echo
echo "=== [3/3] 服务器构建 + 重启容器 ==="
echo

ssh "${SSH_OPTS[@]}" "$SERVER" \
  "cd /opt/el-dorado && ./deploy.sh local"

echo
echo "=== ✅ 部署完成 ==="
echo "访问 http://117.72.204.51/"