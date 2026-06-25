# el-dorado TODO

> 阶段性 god-class 拆分已完成。当前 `main.ts` 与 `Board.ts` 仍是神类，需要另立计划。

## 整体进度（2026-06-26）

| 阶段 | 内容 | commit | 行数变化 |
|------|------|--------|----------|
| Stage A | 拆 `Board.ts` → 6 个 scene owner-class | `eeb6a54` | — |
| B0 | `MobileLayoutProbe` | `fa51641` | — |
| B1 | `HoverStateMachine` | `d6b7d2f` | App −~437 |
| B2 | `ActionLogPanel` | `88469ba` | App −~450 |
| B3 | `InteractionController` | `a630fca` | App −~934 |
| B4 | `BoardCoordinator` | `85896d5` | App −~163 |
| C1 | `PlayerHandPanel` | `2310148` | — |
| C2 | `OverlaysController` | `ab4d7d1` | — |
| C3 | `SettingsMenuController` | `1575019` | — |
| C4 | `SessionController` + `clearRoomState` 闭环 | `6ebc837` | App −~251 |
| C5 | `progressOf` 提到 core | `1bbaf12` | — |
| C6 | `onMessage` 拆薄壳（67 → 12 行） | `a776b54` | App −~50 |
| C7 | `renderHud` TopBar/SettingsDock/MobileToolbar | `14894fc` | App −~14 |
| E | 10 个 terrain/blockade helper 上提到 core | `d2937ea` | core +286 / client −124 |

`App` 从最初 2711 行降到 1039 行（-62%）。`packages/client/src/controllers/` 现在有 9 个 controller，每个 ≤ 934 行。

---

## 当前文件状态（2026-06-26 实测）

- `packages/client/src/main.ts`：**991 行** — App 类占 725 行（`main.ts:71-795`），仍是 god class
- `packages/client/src/scene/Board.ts`：**262 行** — 已是 facade（constructor + 11 个 pass-through + frame driver），**不再需要拆分**
- `packages/core/src/engine.ts`：**~480 行** — state machine + reducer，体积已收住

> ⚠️ MEMORY 里的 "Board 1515 行" 是 Stage A 之前的旧数据；Stage A（commit `eeb6a54`）已把它拆成 6 个 scene owner-class + 一个 facade。

---

# Stage G — main.ts 剩余 cluster 拆分

> 目标：`main.ts` ≤ 300 行，只剩 `constructor` / `onMessage` 薄壳 / `renderHud` 组合器 / `onSocketEvent` / `preloadGameEngine` / 字段声明。
>
> 提取顺序按 DAG 自底向上：纯 helper 先走，复杂组合最后走。

## main.ts 剩余 cluster 盘点（按行数从大到小）

| ID | 集群 | 行号 | ~行数 | 风险 | 归属 |
|----|------|------|-------|------|------|
| **M-12** | `renderHud` — HUD 组合根 | `main.ts:535-790` | 256 | **高** | 新建 `controllers/HudRenderer.ts` |
| **M-13** | 模块级 helper（TERRAIN_INFO 表 + 5 个 info lookup + 3 个 HTML builder） | `main.ts:797-974` | 178 | 低 | 拆成 `controllers/TerrainInfo.ts` + `views/cards/CardDescription.ts` |
| **M-10** | Card preview popover（pinning / 3 个 viewport 分支 / market-preview 变体） | `main.ts:391-498` | 108 | **中-高** | 新建 `controllers/CardPreviewController.ts` |
| **M-5** | App-side host accessor + 小 forwarder | `main.ts:250-313` | 64 | 低 | 大部分保留（host interface 需要） |
| **M-7** | InteractionController 的 20 个 thin wrapper | `main.ts:335-363` | 29 | 中 | 推到 `InteractionHost`（让 view 直接调 `host.interaction.X`） |
| **M-4** | `onMessage` + `act` | `main.ts:222-247` | 26 | 低 | 已是最薄壳 |
| **M-3** | Constructor — wiring + boot | `main.ts:198-220` | 23 | 低 | 保留（这是组合根的本职工作） |
| **M-11** | `renderActionLog` + `renderMobileActionLogDialog` | `main.ts:512-530` | 19 | 低 | 合并到 `ActionLogPanel` |
| **M-8** | `closeMobilePanel` / `flash` forwarder | `main.ts:366-375` | 10 | 低 | 保留 |
| **M-9** | `makePile` forwarder | `main.ts:379-381` | 3 | 低 | 保留 |
| **M-6** | `recomputeHighlights` | `main.ts:320-322` | 3 | 低 | 保留 |
| **M-2** | 字段声明 + HoverHost/ActionLogHost getter 块 | `main.ts:72-196` | 125 | 低 | 保留字段；getter 块 → `controllers/HoverHost.ts`（可选） |
| **M-1** | 模块级常量 + `safeMapId`（**dead code**：`LobbyController:31` 已有同名副本） | `main.ts:63-69` | 7 | 低 | **直接删除** |

合计 ≈ **855 行** 待处理。 抽完后 `main.ts` 预计 ~290 行（hit ≤300 目标）。

## 阶段计划（按 DAG 排）

### ✅ Stage G1 — Dead code + thin wrapper cleanup（~40 行 out）

1. 删除 `main.ts:63-69` 的 `safeMapId` / `MAP_OPTION_IDS` / `DEFAULT_MAP_ID` / `START_COUNTDOWN_MS`（dead code）。
2. 把 M-7 的 20 个 `private` forwarder 删掉，让 view 通过 `host.interaction.X` 直接调（call site 都在 renderHud 内部）。

→ `main.ts` ≈ **950 行**

### ⏳ Stage G2 — Terrain + card-description helper 拆出（~178 行 out）

1. 新建 `controllers/TerrainInfo.ts`：搬 `TERRAIN_INFO` + `terrainInfo` + `blockadeTerrain` + `blockadeInfo` + `terrainCostText` + `blockadeCostText`。`HoverStateMachine` 直接 import，App 上对应的 getter 删掉。
2. 新建 `views/cards/CardDescription.ts`：搬 `cardDescription` + `previewHtml` + `marketInlineDetailHtml`。

→ `main.ts` ≈ **770 行**

### ⏳ Stage G3 — CardPreviewController 拆出（~108 行 out）

1. 新建 `controllers/CardPreviewController.ts`，持有 `preview` DOM node + `attachPreview` / `refreshPinnedPreview` / `showPreview` / `hidePreview` / `isPinned`。
2. Host 接口：`state` / `interaction.{selected,buyTargetDefId,promoteTargetDefId,marketPreviewDefId,marketNeedsPromotion,usesMarketPreviewFlow,canSelectMarketPreview,selectMarketPreviewCard}` / `handEls` / `shopEls` / `mobilePanel` / `mobileLayout.isCompactLandscape`。
3. M-3 的 `preview` append 移交给新 controller；M-10 在 App 上消失；`renderHud` 改调 `previewCtl.refreshPinnedPreview()`。

→ `main.ts` ≈ **660 行**

### ⏳ Stage G4 — ActionLog wrapper + HudRenderer 拆出（~220 行 out）

1. 把 `renderActionLog` + `renderMobileActionLogDialog`（`main.ts:512-530`）合并到 `ActionLogPanel` 为 `buildPanel(variant?: 'desktop' | 'mobile-dialog')`。
2. 新建 `controllers/HudRenderer.ts`：把 `renderHud` body（`main.ts:535-790`）整体搬入 `render(state)`。Host 接口是 renderHud 读到的所有东西。
3. 大块 `market = renderMarketPanel({...})`（`main.ts:596-651`，55 行纯 state 装配）抽成 `prepareMarketInputs(state): MarketPanelInputs`。
4. `handEls` / `shopEls` / `playerCardEls` / `drawPileEl` / `discardPileEl` DOM Map 移到 renderer；`BoardCoordinator.animateBuy` 通过小 `HudDomRefs` accessor 重新拿。

→ `main.ts` ≈ **440 行**

### ⏳ Stage G5 — HoverHost getter 块整理（~60 行 out，可选）

把 `main.ts:100-160` 的 HoverHost getter 块挪到 `controllers/HoverHost.ts`，导出 type + `createHoverHost(app)` adapter。`HoverStateMachine` 直接 import。App 上的 getter 块消失。

→ `main.ts` ≈ **380 行**

### 最后冲刺到 ≤300

- 折叠 `main.ts:253-289` 的小 accessor（`me` / `isMyTurn` / `setMobilePanel` / `hexAt` / `blockadeById`，~30 行）——只被 renderHud 调用
- 内联 `flash` / `closeMobilePanel` / `makePile` / `setDrawPileEl` / `setDiscardPileEl` ——让 consumer 通过 host interface 直接读

→ `main.ts` ≈ **290 行**，hit ≤300 目标。

## 最终文件分布

| 文件 | 起始 | 最终 | 变化 |
|------|------|------|------|
| `main.ts` | 991 | **~290** | −701 |
| `Board.ts` | 262 | 262 | 0 |
| `controllers/HudRenderer.ts`（新） | — | ~180 | +180 |
| `controllers/CardPreviewController.ts`（新） | — | ~130 | +130 |
| `controllers/TerrainInfo.ts`（新） | — | ~140 | +140 |
| `views/cards/CardDescription.ts`（新） | — | ~70 | +70 |
| `controllers/HoverHost.ts`（新，可选） | — | ~70 | +70 |
| `ActionLogPanel.ts` | 450 | 480 | +30 |

总包代码量小幅上升（每个新文件带 import / header / export），但单文件复杂度骤降：所有文件 ≤ 500 行。

---

## 不再计划做的事（明确跳过）

- **Stage D**：把 `core/` 的 `Player` interface 升 class 会破坏 `JSON.parse(JSON.stringify(state))` 的 clone 契约，会让 126 个 core 测试全部失效。已于 2026-06-24 取得用户明确同意跳过。