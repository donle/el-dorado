# el-dorado TODO

> App / engine / AI 三座神类全部拆完。三座山头现在的状态：
>
> - `App` (main.ts) — 243 行（从 2711 行起，-91%）
> - `core/engine/` — 8 个 section，每个 ≤ 213 行（最大 movement.ts）
> - `core/ai/` — 4 个 section，最大 planner.ts 271 行
>
> 客户端最大的单文件现在是 **`InteractionController.ts` 905 行**。下一目标。

## 整体进度（2026-06-28）

| 阶段 | 内容 | commit | 行数变化 |
|------|------|--------|----------|
| Stage A | 拆 `Board.ts` → 6 个 scene owner-class | `eeb6a54` | — |
| B0–B4 | HoverState / ActionLog / Interaction / BoardCoordinator | `fa51641` … `85896d5` | App −~1183 |
| C1–C7 | PlayerHand / Overlays / Settings / Session / progressOf / onMessage / renderHud | `2310148` … `14894fc` | App −~265 |
| E | 10 个 terrain/blockade helper 上提到 core | `d2937ea` | core +286 / client −124 |
| G1–G6 | main.ts 收尾：dead code + 18 个 host 适配器透传 | `af1e170` … `2983ad9` | App −~748（991 → 243）|
| H | `core/engine.ts` (673) → 8 个 section | `7c71484` | core 671 → 8×≤213 |
| I | `core/ai.ts` (471) → 4 个 section | `b5da8f9` | core 471 → 4×≤271 |

---

## 当前文件状态（2026-06-28 实测）

### 客户端（packages/client/src）

| 文件 | 行 | 性质 |
|------|-----|------|
| `main.ts` | **243** | App 类 209 行，只剩字段 + `onMessage` 12 行 switch + `act` + 两个 getter + `renderHud` 一行委派 |
| `controllers/InteractionController.ts` | **905** | ⚠️ **新神类** — selection / legality / input / market / action 全混在一起 |
| `controllers/ActionLogPanel.ts` | 473 | 中型 |
| `controllers/HoverStateMachine.ts` | 436 | 中型 |
| `scene/PawnLayer.ts` | 445 | scene owner |
| `scene/BlockadeRenderer.ts` | 364 | scene owner |
| `scene/HexBoard.ts` | 329 | scene owner |
| `scene/Board.ts` | 262 | facade |
| `lobby/LobbyView.ts` | 348 | view |
| `lobby/LobbyController.ts` | 335 | controller |

### Core（packages/core/src）

`engine/` — `helpers.ts` 98 / `movement.ts` 213 / `buying.ts` 96 / `hand.ts` 35 / `abilities.ts` 87 / `discard.ts` 40 / `turn.ts` 115 / `dispatch.ts` 72 / `index.ts` 5

`ai/` — `helpers.ts` 101 / `pathfinding.ts` 74 / `market.ts` 51 / `planner.ts` 271 / `index.ts` 5

> ⚠️ MEMORY 里的 "Board 1515 行 / App 2417 行" 是 Stage A / Stage B 之前的旧数据。最新值见上表。

---

# Stage G — main.ts 剩余 cluster 拆分 ✅ 已完成

> 目标：把 `main.ts` 压到 ≤ 300 行，只剩组合根本职内容。

| 子阶段 | 内容 | 结果 |
|--------|------|------|
| G1 | dead code + 20 个 thin forwarder | App 991 → 949 |
| G2 | `TerrainInfo` + `CardDescription` 拆出 | App 949 → 766 |
| G3 | `CardPreviewController` 拆出 | App 766 → 660 |
| G4 | `HudRenderer` + `ActionLog` wrappers | App 660 → 376 |
| G5 | `HoverHost` adapter 拆出 | App 376 → 326 |
| G6 | 18 个 thin accessor 折叠 / 内联 | App 326 → **243** |

### G6 详情

G6 把 G1-G5 漏掉的 1-line 透传都干掉，让 consumer 直接走 host interface：

- **HoverHost adapter 内联**：`hexAt` / `blockadeById` 移到 `createHoverHost` 内部读 `state`；`me` / `isMyTurn` 保留在 App（InteractionController / BoardCoordinator / ActionLogPanel 多处用，computed getter 不是 thin forwarder）。
- **删除的 App 透传**：`setMobilePanel` / `sendAction` / `send` / `renderTerrainPanel` / `syncSelectionToState` / `marketNeedsPromotion` / `recomputeHighlights` / `closeMobilePanel` / `flash` / `makePile` / `leaveRoom` / `returnToLobby` / `renderLobby` / `findCardDefId` / `fallbackCardDefId` / `getStore`。
- **consumer 改造**：每个 controller 的 host interface 加上它真正需要的东西 —— `sessionCtl` / `lobbyCtl` / `interaction` 子集 / `overlays` / `boardCtl` / `net` / `hoverMachine` —— 直接读。
- **副作用**：`sessionCtl` 从 `private` 升 `readonly`（被 OverlaysHost / SettingsMenuHost / HudHost / ActionLogHost 用来调 `closeMobilePanel` / `leaveRoom` / `returnToLobby`）。`SessionHost.renderLobby` 是死接口，顺手删。

---

# Stage H — core/engine.ts (673 → 8 sections) ✅ 已完成

commit `7c71484`。

| section | 行 | 责任 |
|--------|-----|------|
| `helpers.ts` | 98 | `clone` / `RuleError` / `player` / `hexAt` / `claimBlockade` / `drawInto` / `takeFromHand` + `isAdjacent` 重导出 |
| `movement.ts` | 213 | `PlayMovementCard` / `StepTo` / `ClearSpace` / `RemoveBlockade` + `assertEnterable` + `finalTurnsAfter` |
| `buying.ts` | 96 | `PromoteMarket` / `BuyCard` + `mintCard` + `MARKET_SLOTS` |
| `hand.ts` | 35 | `RemoveCards`（retire 路径）|
| `abilities.ts` | 87 | `UseAbility`（draw / native / take_free）|
| `discard.ts` | 40 | `DiscardCards` + `pendingTrim` resolve |
| `turn.ts` | 115 | `EndTurn` / `advanceTurn` / `endGame` + AI 兜底 `autoDiscardLowestPower` |
| `dispatch.ts` | 72 | `applyAction` (public) + `dispatch` switch |
| `index.ts` | 5 | barrel |

无环依赖图（discard → turn 单向，turn.ts 拿走 `autoDiscardLowestPower` 是为了切断反向边）。`applyAction` 公开 API 保持不变，157 core + 19 server 测试全过。

---

# Stage I — core/ai.ts (471 → 4 sections) ✅ 已完成

commit `b5da8f9`。

| section | 行 | 责任 |
|--------|-----|------|
| `helpers.ts` | 101 | `enterCost` / `stepPathCost` / `canUseNativeBetween` / `capability` / `canTraverse` / `declareSymbol` / `Need` |
| `pathfinding.ts` | 74 | `pathToFinish`（Dijkstra）|
| `market.ts` | 51 | `marketNeedsPromotion` / `matchesNeed` / `chooseMarketPromotion` |
| `planner.ts` | 271 | `planTurn`（route → step → buy → trim）|
| `index.ts` | 5 | barrel |

无环依赖图。`planTurn` 公开 API 不变，测试全过。

---

# 下一阶段候选（待定优先级）

## Stage J（推荐优先） — InteractionController (905) 拆分

905 行是客户端当前最大的单文件，比 `App` 的最终态 209 行还大 4 倍。结构上分成 5 块可以干净分离的职责：

| 段落 | 范围 | 性质 |
|------|------|------|
| Pure lookups | `hexAt` / `blockadeById` / `handCardIds` / `blockadeBetween` / `blockadeEdges` / `blockadeDestination` | 纯函数（读 state） |
| Movement legality | `movementRequirement` / `canEnter` / `canStepToEldorado` / `canUseNativeOn` / `canClearBlockade` / `canClearSpaceWithSelection` / `canRemoveBlockade` | 纯函数（决策表） |
| Selection lifecycle | `selected` 状态 + `marketNeedsPromotion` / `resetSelection` / `syncSelectionToState` / `recomputeHighlights` | 状态机 |
| Market panel | `usesMarketPreviewFlow` / `onMarketClick` / `previewMarketCard` / `selectMarketPreviewCard` / `canSelectMarketPreview` | 状态机 + UI |
| Input / confirm dispatch | `tryActOnHex` / `tryActOnBlockade` / `onCardClick` / action-card helpers / `confirm*` | state + host 调用 |

建议拆为 4–5 个文件：

```
packages/client/src/controllers/interaction/
├── legality.ts       (pure decision tables: canEnter / canStepToEldorado / ...)
├── selection.ts      (selected: Set<string> + resetSelection / syncSelectionToState / recomputeHighlights)
├── market.ts         (preview-flow: usesMarketPreviewFlow / onMarketClick / previewMarketCard / selectMarketPreviewCard)
├── actions.ts        (action-card helpers: selectedActionCards / useActionCardFromHand / useSelectedAction)
└── index.ts          (InteractionController re-exporting + tryActOnHex / tryActOnBlockade / onCardClick)
```

依赖方向（无环）：
- `legality` ← 所有（决策查询）
- `selection` ← `legality`（`recomputeHighlights` 调 `canEnter` 等）
- `market` ← `selection`（共享 `selected`）
- `actions` ← `selection`
- `index` ← 所有（main controller 持有 selection + 调用 dispatch）

子阶段：
- **J1**：抽 `interaction/legality.ts`（纯函数，零行为风险）
- **J2**：抽 `interaction/actions.ts`（action-card helpers，状态依赖最低）
- **J3**：抽 `interaction/market.ts`（preview flow，状态机独立）
- **J4**：抽 `interaction/selection.ts` + slim 控制器到 ≤ 400 行

每步独立 commit、可回滚、行为不变。

## 其他可重构候选（次优先）

### K — server/room.ts (301)

`packages/server/src/room.ts` 301 行，承担房间生命周期。`@eldorado/server` 已分层（`lobby/`、`transport/`、`shared/`、`game/`），`room.ts` 本身可能还有空间。需要先扫一遍职责边界。

### L — core/ai/planner.ts (271)

`planTurn` 自身 271 行，可以再分 `route`（pathfind + step/clear/native） + `buy`（market promotion + buy + trim）。但 `planTurn` 是顺序流水，分开后跨 section 共享 state，可能得不偿失。建议暂缓。

### M — scene owner 内部精简

`PawnLayer.ts` (445) / `BlockadeRenderer.ts` (364) / `HexBoard.ts` (329) 都是 scene 渲染，每个专注一种 mesh/animation，关注点已分离。如果发现内部 helper 太多可以抽 `scene/util.ts`。**优先级低**，等场景需求稳定再说。

### N — ActionLogPanel.ts (473) 拆分

可能含 desktop 表格 + mobile dialog 两种渲染逻辑，关注点不重叠。值得一拆，但比 J 风险更可控、收益更小。

---

## 不再计划做的事（明确跳过）

- **Stage D**：把 `core/` 的 `Player` interface 升 class 会破坏 `JSON.parse(JSON.stringify(state))` 的 clone 契约，会让 126 个 core 测试全部失效。已于 2026-06-24 取得用户明确同意跳过。