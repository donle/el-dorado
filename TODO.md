# Stage B 后续工作 — App god class 完整拆分

> 创建于 2026-06-25。记录在 push `fa51641` 之后仍待做的 App 拆分任务。
> 当前状态：App 仍是 2711 行的 god class。仅 `MobileLayoutProbe`（49 行）已抽出（commit `fa51641`）。

## 背景

- Stage A 已拆 `Board`（`packages/client/src/scene/Board.ts` → 6 个 owner class）。
- Stage B 第一阶段抽出了 `MobileLayoutProbe`（`packages/client/src/controllers/MobileLayoutProbe.ts`）。
- App 类的 4 个 cluster 仍未抽出：**HoverStateMachine**、**ActionLogPanel**、**InteractionController**、**BoardCoordinator**。
- 整体策略：每个 cluster 一个 commit + 一次 type-check + 一次 vite build + 一次 E2E（桌面 + 移动端）。

## 待办（按风险从低到高）

### B1. HoverStateMachine
- **位置**：`packages/client/src/controllers/HoverStateMachine.ts`
- **字段**（6 个）：
  - `pinnedPlayerId: string | null`
  - `hoveredTerrain: Axial | null`
  - `pinnedTerrain: Axial | null`
  - `hoveredBlockadeId: string | null`
  - `pinnedBlockadeId: string | null`
  - `terrainPanelHovering: boolean`
  - `terrainHoverClearTimer: number | null`
- **方法**（~12 个）：
  - `onHexHover(coord: Axial | null): void`
  - `onHexClick(coord: Axial): void`
  - `onBlockadeHover(id: string | null): void`
  - `onBlockadeClick(id: string): void`
  - `renderTerrainPanel(extraClass?: string): HTMLElement`
  - `closeTerrainPanel(): void`
  - `cancelTerrainHoverClear(): void`
  - `scheduleTerrainHoverClear(): void`
  - `bindTerrainPanelHover(): void`
  - `showLogTerrainPreview(coord: Axial | null, blockadeId: string | null): void`
  - `terrainActionStatus(coord: Axial): { text: string; canAct: boolean } | null`
  - `blockadeActionStatus(id: string): { text: string; canAct: boolean } | null`
- **依赖**：需要 `board` (Board instance)、`terrainPanel` (HTMLElement)、`preview` (HTMLElement)、`mobileLayout` (MobileLayoutProbe)、`refreshPinnedPreview`、`attachPreview`、`showPreview`、`hidePreview`、`isMobileDevice`、`board.setInspectedHex`、`board.setInspectedBlockade`、`board.clearInfoHover`、`closeMobilePanel`。
- **风险**：跨 cluster 较多（要回调到 Board、其他 UI），但状态机本身自洽。先把它做成一个 class、构造时注入所有需要的回调，避免在 App 上留 wrapper 方法。
- **commit 信息**：把字段移走 + 把方法移走 + 在 App 上替换为 `private hoverMachine = new HoverStateMachine(...)`。

### B2. ActionLogPanel
- **位置**：`packages/client/src/controllers/ActionLogPanel.ts`
- **字段**（5 个）：
  - `actionLog: ActionLogEntry[]`
  - `actionLogSeq: number`
  - `actionLogLastRenderedId: number`
  - `hasRenderedLog: boolean`
  - `knownCardDefs: Map<string, string>`
- **方法**（~15 个）：
  - `appendActionLog(events, state, previousState)`
  - `resetActionLog()`
  - `rememberCards(state)`
  - `cardDefIdForLog(cardId, state, previousState)`
  - `cardSegmentByDefId(defId)`
  - `cardSegmentByCardId(cardId, state, previousState)`
  - `playerLogInfo(playerId, state, previousState)`
  - `activeMoverForPlayer(playerId, state, previousState)`
  - `activeMoverForCard(cardId, state, previousState)`
  - `terrainLogSegment(to, state)`
  - `blockadeLogSegment(blockadeId)`
  - `inferTakenMarketDefId(state, previousState)`
  - `makeActionLogEntry(playerId, segments, state, previousState)`
  - `describeActionEvents(events, state, previousState)`
  - `buildActionLogPanel(extraClass?)` — 与 HoverStateMachine 一样需要外部回调
  - `renderActionLog()`
  - `renderMobileActionLogDialog()`
- **类型**：把 `ActionLogEntry`、`ActionLogSegment` 从 main.ts module-level 移到 ActionLogPanel.ts（同文件 export）。
- **依赖**：与 HoverStateMachine 共享同样的"回调注入"模式。`buildActionLogPanel` 需要 `attachPreview`、`showPreview`、`showLogTerrainPreview`（属于 HoverStateMachine）、`board.setInfoHoverHex`、`board.setInfoHoverBlockade`、`board.clearInfoHover`、`closeMobilePanel`、`isMobileDevice`。这意味着 B1 必须先做。
- **风险**：buildActionLogPanel 的 event listener 注册逻辑跨多个 cluster，先抽出 state machine 再抽 panel。

### B3. InteractionController
- **位置**：`packages/client/src/controllers/InteractionController.ts`
- **字段**（9 个）：
  - `selected: Set<string>`
  - `mode: Mode`（类型 `Mode` 也要搬过来）
  - `buyTargetDefId: string | null`
  - `promoteTargetDefId: string | null`
  - `marketPreviewDefId: string | null`
  - `nativeActionCardId: string | null`
  - `clearTarget: Axial | null`
  - `clearBlockadeId: string | null`
  - `removeAfterDrawLimit: number`
- **方法**（~30 个）：
  - `onCardClick(cardId)` / `onMarketClick(defId)` / `onHexClick`（与 HoverStateMachine 共享；hover 调用或注入）
  - `tryActOnHex` / `tryActOnBlockade`
  - `useActionCardFromHand` / `useSelectedAction`
  - `selectedHandCardIds` / `selectedActionCards` / `selectedActionCard` / `selectedActionRemoveIds` / `removeLimitForAbility` / `selectedActionUseLabel` / `handActionUseLabel`
  - `canUseSelectedAction` / `canSelectMarketPreview` / `previewMarketCard` / `selectMarketPreviewCard`
  - `promoteMarket` / `confirmPromoteMarket` / `confirmBuy` / `confirmRemoveAfterDraw` / `confirmTrim`
  - `cancelMode` / `syncSelectionToState` / `resetSelection`
  - `recomputeHighlights` / `marketNeedsPromotion`
  - 纯函数：`hexAt` / `blockadeById` / `blockadeBetween` / `blockadeEdges` / `blockadeDestination`
  - 移动合法性：`canClearBlockade` / `canClearSpaceWithSelection` / `canRemoveBlockade` / `movementRequirement` / `canEnter` / `canStepToEldorado` / `canUseNativeOn`
  - getter：`me` / `isMyTurn`
- **依赖**：需要 `state`、`you`、`room`、`net`（用于发 `action`）、`board`（设置 highlights + inspection）、`store`（reset 时同步）、`syncSelectionToState`（被 onMessage 调用）。
- **风险**：最大。30+ 个方法里有 7 个纯移动合法性函数——它们不依赖任何 mutable 状态，**可以最先抽出作为 static methods**。其余 ~20 个方法都跨 cluster（onMessage / renderHud / showPreview / board.setHighlights），需要设计清晰的回调接口。

### B4. BoardCoordinator
- **位置**：`packages/client/src/controllers/BoardCoordinator.ts`
- **方法**（~5 个，但都是"蜘蛛"——跨多个 cluster）：
  - `enterGameView(state)` — 调 `board.render` / `board.setSelfPlayerId` / `board.setHighlights` / `renderTerrainPanel`（hover）
  - `showTurnIntro()` / `clearTurnIntro()` — 薄包装 TurnIntroOverlay
  - `animateBuy(playerId, defId, sourceRect)` — flyCard + 用 `handEls` / `shopEls` / `playerCardEls` / `drawPileEl` / `discardPileEl`（属于 App facade 的 DOM refs）
  - `flyCard(fromEl, toEl, cardFace, defId)` — DOM 动画
- **依赖**：依赖于 B1/B2/B3 都完成后的 HoverStateMachine.renderTerrainPanel、ActionLogPanel 的某个 list 渲染逻辑、InteractionController 的 `me` getter。
- **风险**：纯编排器，最后做。如果前 3 步做得干净，B4 就是把 App 现有 `onMessage` 里的 30 行拆到一个独立 class，App 瘦到 <500 行。

## 每阶段 commit 模板

每个 B 阶段 commit 之前必做：
1. 跑 `pnpm -r test -- --run`（unit/integration）
2. 跑 `pnpm --filter @eldorado/client exec tsc --noEmit`
3. 跑 `pnpm --filter @eldorado/client exec vite build`
4. 跑 E2E：起 server + Playwright（桌面 viewport + 移动 iPhone viewport），走 lobby → game → AI turn → 玩家出牌 流程
5. 跑端到端 + 移动端截图确认无 regression

## 当前 App 文件状态

- `packages/client/src/main.ts`：1387 行（B1+B2+B3+B4 全部完成）
- `packages/client/src/controllers/`：5 个 controller
  - `MobileLayoutProbe.ts`：49 行（B0）
  - `HoverStateMachine.ts`：437 行（B1）
  - `ActionLogPanel.ts`：450 行（B2）
  - `InteractionController.ts`：934 行（B3）
  - `BoardCoordinator.ts`：163 行（B4）

## 不再计划做的事（明确跳过）

- **Stage D**：把 `core/` 的 `Player` interface 升 class 会破坏 `JSON.parse(JSON.stringify(state))` 的 clone 契约，会让 126 个 core 测试全部失效。已于 2026-06-24 取得用户明确同意跳过。