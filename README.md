# El Dorado Online

一个 TypeScript 全栈的《冲向黄金城》(The Quest for El Dorado) 联机实现。

项目把桌游规则、联机房间和浏览器渲染拆成独立 package：核心规则引擎保持纯函数和确定性，Node WebSocket 服务端作为权威裁判，客户端用 Three.js 渲染 2.5D 六角棋盘和牌面交互。

> 这是一个个人学习和实验项目，不隶属于 Ravensburger、Reiner Knizia 或官方发行方。

## 功能

- 2-4 人联机房间，支持 4 字母房间码。
- 房主创建房间、邀请玩家、添加或移除 AI、开始游戏。
- 服务端权威校验操作，客户端只发送行动意图并渲染快照。
- 固定经典地图、六角格移动、起点和终点、山脉、碎石和大本营。
- 起始牌库、市场牌、买牌、弃牌、洗牌、精简牌库和最终轮判胜。
- 服务端 AI 通过同一套 action API 行动，可用于补齐玩家。
- Three.js 棋盘渲染，HTML overlay 展示大厅、手牌、市场、回合信息和玩家状态。

## 项目结构

```text
.
├── docs/
│   └── superpowers/specs/2026-06-18-el-dorado-online-design.md
├── packages/
│   ├── core/      # 纯规则引擎、卡牌、地图、协议、AI、测试
│   ├── server/    # Node + ws 权威服务器和房间管理
│   └── client/    # Vite + Three.js 浏览器客户端
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

### `@eldorado/core`

无渲染、无网络的确定性规则层。包含：

- `applyAction(state, action)` reducer
- 卡牌目录和市场配置
- 六角格坐标、地图解析和经典地图
- seeded RNG
- 前后端共享的 WebSocket 协议类型
- 简单 AI planner

### `@eldorado/server`

Node WebSocket 服务端，默认监听 `ws://localhost:8787`。

- 管理房间码、玩家、房主和连接状态
- 持有 canonical game state
- 校验客户端 action intent
- 广播房间信息和完整游戏快照
- 自动运行 AI 回合

### `@eldorado/client`

Vite 开发服务器，默认运行在 `http://localhost:5173`。

- 开发环境连接 `ws://<hostname>:8787`
- 生产环境连接同域 `/ws`
- Three.js 正交相机渲染棋盘、地形、棋子和路径反馈
- DOM overlay 承载手牌、市场、房间和操作按钮

## 快速开始

需要 Node.js 和 pnpm。

```bash
pnpm install
```

启动服务端：

```bash
pnpm dev:server
```

启动客户端：

```bash
pnpm dev:client
```

然后打开：

```text
http://localhost:5173
```

创建房间后，把 4 字母房间码发给其他玩家。也可以在大厅里添加 AI，然后开始游戏。

## 脚本

```bash
pnpm test
pnpm build
pnpm dev:server
pnpm dev:client
```

单独运行 package：

```bash
pnpm --filter @eldorado/core test
pnpm --filter @eldorado/server test
pnpm --filter @eldorado/client build
```

## 玩法速览

- 每名玩家起始手牌上限为 4。
- 绿色牌提供砍刀，用于进入丛林格。
- 蓝色牌提供船桨，用于进入河流格。
- 黄色牌提供金币，用于进入村庄格，也用于购买市场牌。
- 万能牌出牌时选择一种符号使用。
- 进入一个格子必须由一张牌单独支付，不能多张牌拼同一个格子的费用。
- 一张移动牌的剩余点数可以继续进入后续相邻格。
- 碎石格需要弃掉指定数量的牌。
- 大本营需要永久移除指定数量的牌。
- 每回合最多购买一张市场牌，买入弃牌堆。
- 第一个抵达黄金城的玩家触发最终轮，最终按规则判定胜者。

## 开发说明

核心设计目标是让规则和表现层解耦：

- `core` 可以被服务端、客户端测试和 AI 同时复用。
- 服务端永远是权威状态来源。
- 客户端不直接修改游戏状态，只负责提交意图和渲染服务端快照。
- 所有随机过程通过 seeded RNG 进入规则层，便于复现和测试。

详细设计文档在：

```text
docs/superpowers/specs/2026-06-18-el-dorado-online-design.md
```

## 当前状态

这是 MVP 阶段，核心循环已经覆盖到移动、购买、弃牌、抽牌、精简、AI 行动和胜负判定。

仍待完善：

- 模块化地图拼接
- 洞穴扩展
- 更完整的行动牌 UI
- 断线重连体验
- 账号、战绩和观战
- 部分市场牌费用仍需用实体卡或官方资料核对

