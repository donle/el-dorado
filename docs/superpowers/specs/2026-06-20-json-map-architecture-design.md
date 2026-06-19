# JSON 数据驱动的拼装地图架构

日期：2026-06-20
状态：已确认设计，待实现

## 背景

游戏《黄金国之路》(The Quest for El Dorado) 已有一套基于六边形板块的拼装地图系统
（`packages/core/src/maps/tile.ts`），但板块内容是**程序化生成**的：`cellSpec` 按
`TileTheme` 计算地形与消耗，障碍 (`buildBlockades`) 自动选位并按 index 分配资源。

本设计把它改造为**数据驱动**：每个大陆板块用 JSON 逐格描述地形与资源数量，大地图用
连接表显式描述板块边对边的拼接，障碍在连接上显式声明所需资源类型与数量。

## 地图组成单位（需求 1）

- **蜂巢**：最小单位，对应 `Hex`（axial 坐标 + 地形 + 消耗）。
- **大陆板块**：side-4 正六边形 = 37 格（`TILE_RADIUS=3`），用 JSON 描述。
- **终点异形地形**：黄金城 + 3 个入口，不规则板块，由加载器内置生成（见下）。

## 决策记录

1. **完全替换为 JSON**——废弃 `cellSpec` 等程序化生成；现有 classic 地图也转成 JSON。
2. **板块格式 = 蜂巢行**——7 行，行宽 `4·5·6·7·6·5·4 = 37`，复用 `parse.ts` token 词表。
3. **大地图 = 连接表/图**——板块实例 + connections 列表，支持分叉，障碍挂在连接上。
4. **障碍 = 每条接缝一个，自动定位**——作者只声明 `{type, cost}`，位置由拼接几何自动算。
5. **终点 = 内置特性挂在 `role:"end"` 板块上**——复用现有 `attachEldorado` 几何，蜂巢坐标不手写。

`GameMap` 输出类型**保持不变**，engine / client / server 零改动；改造局限在 `maps/` 内。

## 模块边界

| 文件 | 职责 | 输入 → 输出 |
|---|---|---|
| `maps/plate.ts` | 板块解析器：7 行六边形 token → 37 本地蜂巢 | 板块 JSON → `PlateDef`（本地 axial 格子 + 地形/消耗/起点槽位）|
| `maps/data/plates/*.json` | 板块库：每个大陆板块一个 JSON | 静态数据 |
| `maps/data/*.map.json` | 大地图库：板块实例 + 连接表 | 静态数据 |
| `maps/assemble.ts` | 拼装器：连接表 → 放置 → 物化 → 建障碍 → 挂黄金城 | 大地图 JSON + 板块库 → `GameMap` |
| `maps/index.ts` | 注册 & `getMap(id)` | — |

**删除**：`cellSpec` / `PRIMARY` / `SECONDARY` / `SPECIALS` / 主题算地形；`buildBlockades`
里按 index 分配资源的逻辑。
**保留并复用**：`EDGE_OFFSET` / `OPPOSITE_EDGE` / `neighborCenter` / 接缝跨边探测 /
`attachEldorado` / `localCells` 坐标系。`parseGrid`（corridor 测试地图）保持不动，与板块架构正交。

## 数据格式

### 板块 JSON（`data/plates/jungle-a.json`）

```json
{
  "id": "jungle-a",
  "theme": "jungle",
  "rows": [
    "g2 y1 b3 g1",
    "g1 b2 MM g3 y2",
    "y1 g2 b1 g2 y3 g1",
    "g2 b3 g1 CC y2 g1 b2",
    "g3 y1 g2 b2 g1 y2",
    "b1 g2 y3 g1 b2",
    "g2 y1 g3 b1"
  ]
}
```

Token 词表（复用 `parse.ts`，去掉 `F`，新增起点 `S`）：

| token | 含义 |
|---|---|
| `g1‑g4` / `b1‑b4` / `y1‑y4` | 绿(砍刀)/蓝(船桨)/黄(金币) + 消耗值 |
| `R1‑R4` | 碎石（弃任意牌）|
| `C1‑C4` | 营地（移除任意牌）|
| `MM` | 山（不可通行）|
| `S1‑S4` | 起点槽位（仅起点板块用）|

- `theme` 只用于贴图/视觉，不再决定地形。
- 行/列 → 本地 axial 坐标由解析器按六边形几何映射，中心 `(0,0)`，与现有 `localCells()` 同坐标系。

### 大地图 JSON（`data/classic.map.json`）

```json
{
  "id": "classic",
  "name": "黄金城之路",
  "plates": [
    { "id": "start", "ref": "start-a" },
    { "id": "j1",    "ref": "jungle-a" },
    { "id": "r1",    "ref": "river-b"  },
    { "id": "end",   "ref": "end-a", "role": "end" }
  ],
  "connections": [
    { "from": "start", "edge": "up",         "to": "j1" },
    { "from": "j1",    "edge": "right-up",   "to": "r1",
      "blockade": { "type": "machete", "cost": 2 } },
    { "from": "r1",    "edge": "right-down", "to": "end" }
  ]
}
```

- `plates[].id` 是实例 id（同一 `ref` 可复用多次）；`role:"end"` 标记挂黄金城的板块。
- `edge` ∈ 现有 6 个 `TileEdge`（`up`/`down`/`left-up`/`left-down`/`right-up`/`right-down`）；
  `to` 自动用 `OPPOSITE_EDGE` 回接。
- `blockade.type` ∈ `machete | paddle | coin | discard`（`discard` = 碎石式弃牌，无 symbol）；
  `cost` = 所需资源数量。可选——缺省即为无障碍的开放接缝。

## 拼装流程（`assemble.ts`，纯函数）

1. **放置**：以 `connections` 建图，取第一个板块为根置于 `(0,0)`；BFS 遍历，每条连接用
   `EDGE_OFFSET[edge]` 算邻接板块中心。每个板块只被定位一次（重复定位 = 冲突 → 报错）。
2. **物化**：每个已放置板块的本地格子平移到世界坐标，按 key 去重共享接缝格（同现
   `assembleTiles`）。收集 `startHexes`。
3. **建障碍**：对每条带 `blockade` 的连接，复用现有接缝跨边探测选出代表跨边；
   terrain/symbol/cost 来自作者声明的 `{type, cost}`，不再按 index 自动分配。
   `discard` → rubble 纹理、无 symbol、cost = 弃牌数。
4. **挂终点**：对 `role:"end"` 板块调用移植后的 `attachEldorado`，生成异形黄金城 + 3 入口。
5. 返回 `GameMap`。

## 校验（加载即失败，错误信息中文，沿用现有风格）

- 板块：恰 7 行；行宽依次 `4·5·6·7·6·5·4`；共 37 格；每个 token 合法；起点板块含连续 `S` 槽位。
- 大地图：`ref` / `from` / `to` 都存在；`edge` 合法；连接图连通；放置后除共享接缝外无重叠；
  恰一个 `role:"end"`。

## 迁移

- 把现 `CLASSIC_MAP` 的 start/jungle/river/village/end 五块转成 5 个板块 JSON + `classic.map.json`，
  内容等价（地形分布尽量复刻当前观感）。
- `getMap('classic')` 行为不变，下游零改动。
- `corridor` 保留 `parseGrid` 不动。
- 删除 `tile.ts` 程序化生成函数；几何常量与 `attachEldorado` 迁入 `assemble.ts` / `plate.ts`。

## 测试

- 板块解析：行宽 / 坐标映射 / token 校验。
- 拼装放置：无重叠、图连通、`EDGE_OFFSET` 正确回接。
- 障碍：资源类型与数量来自声明；`discard` 走弃牌语义。
- 终点：黄金城 + 3 入口正确挂载。
- 回归：classic 迁移后 hex 数 / 起点 / 终点与旧实现一致。
