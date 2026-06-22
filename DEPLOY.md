# 部署指南（京东云轻量云主机 + Docker + Caddy + GitHub Actions）

> 跟 double-jump 共用同一台服务器（117.72.204.51），但已切换为独立镜像 `ghcr.io/donle/el-dorado`、容器名 `el-dorado`、部署目录 `/opt/el-dorado`。首次部署时 `deploy.sh` 会自动清理 double-jump 留下的旧容器和镜像。

---

## 0. 前置清单

| 资源 | 要求 |
|---|---|
| 京东云轻量云主机 | 1C1G 40G SSD，Ubuntu 22.04 LTS |
| 公网带宽 | ≥ 3 Mbps（轻量默认即可） |
| 域名 | 一个，解析到服务器公网 IP（境内需 ICP 备案，香港/境外节点免） |
| GitHub 仓库 | `donle/el-dorado`（已 push） |
| 本地 | Docker（仅测试 build 用，可选） |

---

## 1. 服务器初始化（首次，约 10 分钟）

### 1.1 京东云控制台

- 重置 root 密码
- 防火墙放通：`22 (SSH)`、`80 (HTTP)`、`443 (HTTPS)`
- 记下公网 IP：`117.72.204.51`

### 1.2 SSH 登录 + 装基础环境

```bash
ssh root@117.72.204.51

# 装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# 装 Caddy（自动 HTTPS）
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# 防火墙
ufw allow 22/tcp 80/tcp 443/tcp
```

> CentOS 7 系统请参考 §7.3 节用二进制方式装 Caddy；京东云默认镜像可能是 CentOS 7。

### 1.3 拉代码 + 首次手动部署

```bash
# 创建部署目录（独立于 double-jump 的 /opt/double-jump）
mkdir -p /opt/el-dorado
cd /opt/el-dorado

# 拉代码
git clone git@github.com:donle/el-dorado.git .

# 配环境变量
cp .env.example .env
nano .env
# 内容默认就行：
#   IMAGE=ghcr.io/donle/el-dorado
#   CONTAINER=el-dorado
#   PORT=3000

# 给脚本加执行权限
chmod +x deploy.sh scripts/deploy.sh

# 首次构建（不依赖 ghcr.io 已有镜像）
./deploy.sh local
```

预期输出：
- 自动停掉并删除旧 `double-jump` 容器（如有）
- 自动删除旧镜像 `ghcr.io/donle/double-jump:*`（如有）
- 构建新镜像 → 启动 `el-dorado` 容器 → `HTTP 200` 健康检查通过

### 1.4 Caddy 接 HTTPS

```bash
nano /etc/caddy/Caddyfile
```

内容（替换 `YOUR.DOMAIN.COM`）：

```
YOUR.DOMAIN.COM {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
```

> Caddy 2.6+ 的 `reverse_proxy` 已内置 WebSocket 自动透传，无需手写 `header_up Upgrade/Connection`。
> 验证：`curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://YOUR.DOMAIN.COM/ws` 应返回 `101`。

```bash
systemctl reload caddy
```

打开浏览器访问 `https://YOUR.DOMAIN.COM/` —— 应能进游戏。

> **首次访问会等 10~30 秒**：Caddy 正在向 Let's Encrypt 申请证书。

---

## 2. CI/CD（git push 自动部署）

### 2.1 GitHub 仓库 → Settings → Secrets and variables → Actions，新增：

| Secret 名 | 值 | 说明 |
|---|---|---|
| `SERVER_HOST` | `117.72.204.51` | 服务器公网 IP |
| `SERVER_USER` | `root` | SSH 用户 |
| `SERVER_SSH_KEY` | 服务器私钥全文（含 BEGIN/END 行） | 见下 |
| `PUBLIC_URL` | `https://YOUR.DOMAIN.COM` | 部署完冒烟测试用 |

#### 生成专属 SSH 密钥对

```bash
# 本地
ssh-keygen -t ed25519 -C "github-actions-el-dorado" -f ~/.ssh/el_dorado_deploy

# 把公钥加到服务器（如果你已经有 double-jump 的密钥对，reused 即可）
cat ~/.ssh/el_dorado_deploy.pub | ssh root@117.72.204.51 \
  "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

把私钥全文贴到 GitHub Secret `SERVER_SSH_KEY`。

> 如果用 double-jump 同一份密钥（`~/.ssh/double_jump_deploy`），直接复用即可，无需生成新的。`scripts/deploy.sh` 默认也是找这个名字的密钥。

### 2.2 启用 ghcr.io 公开拉取

- 第一次 push 完，到 GitHub 仓库页面 → 顶部 Packages 链接 → `el-dorado` → Package settings → Change visibility → Public
- 或者在服务器上登录：`echo TOKEN | docker login ghcr.io -u donle --password-stdin`（私有也行，但首次要登录一次）

### 2.3 测试

```bash
# 本地改一行
git add . && git commit -m "test ci" && git push origin main
# GitHub Actions 应在 2~5 分钟内：build 镜像 → push → SSH 部署 → smoke test 通过
```

---

## 3. 日常运维

| 操作 | 命令 |
|---|---|
| 看实时日志 | `docker logs -f el-dorado` |
| 进容器调试 | `docker exec -it el-dorado sh` |
| 重启 | `docker restart el-dorado` |
| 本地一键部署 | `cd <repo-root> && scripts/deploy.sh "feat: xxx"` |
| 手动部署指定版本 | `cd /opt/el-dorado && ./deploy.sh v1.2.3` |
| 看容器资源 | `docker stats el-dorado` |
| 磁盘清理 | `docker system prune -af --filter "until=72h"` |

---

## 4. 故障排查

### `pnpm install` 在 Docker 内失败，提示 `ERR_PNPM_IGNORED_BUILDS`

仓库根 `pnpm-workspace.yaml` 已声明 `allowBuilds: esbuild: true`。如果还报错：

- 在**本地**跑一次 `pnpm approve-builds`，勾 esbuild，生成 `pnpm-lock.yaml` 后 commit
- 然后再 push，CI 用 `--frozen-lockfile` 才能稳

### 服务器连不上 ghcr.io

- 检查防火墙是否放通 443
- `docker pull ghcr.io/donle/el-dorado:latest` 看具体报错
- 如果是未登录，参考 §2.2 把包公开或登录

### 容器起得来但页面 502

- `docker logs el-dorado` 看启动日志（应该看到 `http://localhost:3000`）
- `curl -i http://127.0.0.1:3000/` 从服务器本地测
- Caddy 没配好？`systemctl status caddy` 看错误

### WebSocket 连不上

- 浏览器 F12 → Network → WS 标签
- 应该看到 `wss://YOUR.DOMAIN.COM/ws` 状态 101 Switching Protocols
- 如果一直 pending：Caddy 版本是否 ≥ 2.6（旧版需要手写 `header_up Upgrade/Connection`）

### 旧 double-jump 容器残留

`deploy.sh` 已自动清理。如果手动部署时残留：

```bash
docker stop double-jump 2>/dev/null; docker rm double-jump 2>/dev/null
docker image rm -f ghcr.io/donle/double-jump:latest 2>/dev/null
# 顺手把旧部署目录也清掉（如果不需要回滚）
rm -rf /opt/double-jump
```

### 服务器重启后容器没起来

- `docker ps -a` 看状态
- 如果是 Exited：`docker logs el-dorado` 看为什么
- `--restart unless-stopped` 应该在机器重启后自动拉起，但如果 docker daemon 没启动就要 `systemctl start docker`

### 磁盘满了

```bash
df -h                          # 看哪个分区满了
docker system df               # 看 docker 占多少
docker system prune -af        # 清掉所有不用了的镜像/容器/网络
```

---

## 5. 安全清单（上线前确认）

- [ ] 服务器 SSH 改用密钥登录，禁用密码登录
- [ ] 防火墙只开 22/80/443
- [ ] Caddy 自动续期证书，不用管
- [ ] `.env` 不要进 git（已在 `.gitignore`）
- [ ] GitHub Personal Access Token 不用开太宽权限
- [ ] 服务器定期 `apt update && apt upgrade`

---

## 6. IP 模式（无域名）

适合**临时演示 / 内网测试 / 不想搞备案**。

### 6.1 Caddyfile 配置

```
:80 {
    bind 0.0.0.0
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}

:443 {
    bind 0.0.0.0
    tls /etc/caddy/tls/117.72.204.51.crt /etc/caddy/tls/117.72.204.51.key
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
```

### 6.2 自签名证书生成

公共 CA 不给裸 IP 签证书，必须自签。**浏览器会弹一次"您的连接不是私密连接"**，无法避免。

```bash
mkdir -p /etc/caddy/tls
openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
  -keyout /etc/caddy/tls/117.72.204.51.key \
  -out /etc/caddy/tls/117.72.204.51.crt \
  -subj '/CN=117.72.204.51'
chown -R caddy:caddy /etc/caddy/tls
chmod 600 /etc/caddy/tls/*.key
chmod 644 /etc/caddy/tls/*.crt
```

### 6.3 访问选项

| 方式 | 体验 |
|---|---|
| `http://117.72.204.51/` | 无警告，但 Chrome 如果开了 "Always use secure connections" 会强升 https |
| `https://117.72.204.51/` | 首次弹"连接不是私密连接"，点"高级"→"继续前往" |

### 6.4 如果有域名（最优路径）

把 §6.1 整个替换为：

```
your.domain.com {
    reverse_proxy 127.0.0.1:3000
    encode zstd gzip
}
```

Caddy 自动从 Let's Encrypt 申请证书，全 https 无警告。

---

## 7. 京东云 + CentOS 7 部署踩坑

### 7.1 默认源是死的

京东云默认实例是 CentOS 7（已 EOL），默认 yum 源是死的。`curl get.docker.com | sh` 能跑（走的是 `download.docker.com`，独立源）。Docker 装得上。

### 7.2 `docker pull` 拉 docker.io 镜像超时

京东云出口网络到 docker.io 慢 / 不稳。配 mirror：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com",
    "https://docker.mirrors.ustc.edu.cn"
  ],
  "max-concurrent-downloads": 5
}
EOF
systemctl restart docker
docker pull hello-world   # 验证
```

### 7.3 Caddy 不在默认源

CentOS 7 装 Caddy 最稳的姿势：直接拉 GitHub release 的静态二进制，**不要走 yum**：

```bash
curl -sSLf -o /tmp/caddy.tar.gz \
  "https://github.com/caddyserver/caddy/releases/download/v2.8.4/caddy_2.8.4_linux_amd64.tar.gz"
tar -xzf /tmp/caddy.tar.gz caddy -C /usr/local/bin
chmod +x /usr/local/bin/caddy
/usr/local/bin/caddy version
```

systemd unit 文件参考：https://github.com/caddyserver/caddy/tree/master/dist/init/linux-systemd

### 7.4 pnpm 11 + Docker build 的注意事项

`package.json` 里有 `"packageManager": "pnpm@11.5.0"`，pnpm 在 Docker 内可能触发自举导致 EPERM。**Dockerfile 已用 `corepack prepare pnpm@11.5.0 --activate` 显式激活**，避开自举。如果还报错，参考：

```dockerfile
RUN pnpm install --no-lockfile --filter @eldorado/client... \
    --config.strict-dep-builds=false --ignore-scripts 2>&1 | tail -20
```

### 7.5 el-dorado 根 `package.json` 名字是 `el-dorando`（typo）

不影响部署，但后续如果要发包可能要改一下。

### 7.6 SSH 私钥如果已经泄漏，立即作废

1. 在新机器上生成新密钥对
2. 把新公钥加到服务器 `~/.ssh/authorized_keys`
3. 服务器 `passwd -l root`
4. `/etc/ssh/sshd_config` 设 `PasswordAuthentication no`
5. `systemctl restart sshd`

---

## 8. 与 double-jump 的关系

| 资源 | double-jump | el-dorado |
|---|---|---|
| 服务器 | 117.72.204.51 | 同上（共享） |
| 部署目录 | /opt/double-jump | /opt/el-dorado |
| 镜像 | ghcr.io/donle/double-jump | ghcr.io/donle/el-dorado |
| 容器名 | double-jump | el-dorado |
| 宿主机端口 | 3000 | 3000（同） |
| Caddy 反代 | 127.0.0.1:3000 | 同上（共享） |

**两个项目不能同时跑**（端口冲突）。如果以后要同时跑，第二个项目的 Dockerfile 里 `EXPOSE` 和 deploy.sh 的端口映射都要改成 3001 等，再加一条 Caddy 反代。

---

## 9. 备份与回滚

```bash
# 看服务器上有哪些 image tag
docker images ghcr.io/donle/el-dorado

# 手动回滚到上一个 tag（tag 在 GitHub Packages 找）
cd /opt/el-dorado && ./deploy.sh <上一个 tag>

# 完全删除项目（连部署目录一起）
docker stop el-dorado && docker rm el-dorado
docker image rm -f $(docker images -q ghcr.io/donle/el-dorado)
rm -rf /opt/el-dorado
# 别忘了去 Caddyfile 删掉对应 server block，然后 systemctl reload caddy
```