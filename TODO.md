# Stage B/C 后续工作 — App god class 完整拆分

> 创建于 2026-06-25，记录 push `fa51641` 之后的 App 拆分任务。
> 当前状态：B0–B4 全部完成（commit `d6b7d2f` / `88469ba` / `a630fca` / `85896d5` / `23c3407`）。
> App 从 2711 行降到 1387 行（49%），5 个 controller 落位（~2033 行总规模）。

## 背景

- Stage A 已拆 `Board`（`packages/client/src/scene/Board.ts` → 6 个 owner class）。
- Stage B 抽出 5 个 App 子系统：`MobileLayoutProbe`、`HoverStateMachine`、`ActionLogPanel`、`InteractionController`、`BoardCoordinator`。
- App 仍承担 ~10 个尚未拆出的 cluster（详见下文 Stage C）。整体策略保持不变：每个 cluster 一个 commit + type-check + vite build + E2E。
- 整体目标：把 App 压到 ~300 行「纯组合 + 生命周期」职责。

---

## ✅ B1. HoverStateMachine （已完成 · commit `d6b7d2f`）
- **位置**：`packages/client/src/controllers/HoverStateMachine.ts`
- **字段**（7 个）：
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

### ✅ B2. ActionLogPanel （已完成 · commit `88469ba`）
- **位置**：`packages/client/src/controllers/ActionLogPanel.ts` · 450 行
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

### ✅ B3. InteractionController （已完成 · commit `a630fca`）
- **位置**：`packages/client/src/controllers/InteractionController.ts` · 934 行
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

### ✅ B4. BoardCoordinator （已完成 · commit `85896d5`）
- **位置**：`packages/client/src/controllers/BoardCoordinator.ts` · 163 行
- **方法**（7 个，但都是"蜘蛛"——跨多个 cluster）：
  - `enterGameView(state)` — 调 `board.render` / `board.setSelfPlayerId` / `board.setHighlights` / `renderTerrainPanel`（hover）
  - `showTurnIntro()` / `clearTurnIntro()` — 薄包装 TurnIntroOverlay
  - `animateBuy(playerId, defId, sourceRect)` — flyCard + 用 `handEls` / `shopEls` / `playerCardEls` / `drawPileEl` / `discardPileEl`（属于 App facade 的 DOM refs）
  - `flyCard(fromEl, toEl, cardFace, defId)` — DOM 动画
- **依赖**：依赖于 B1/B2/B3 都完成后的 HoverStateMachine.renderTerrainPanel、ActionLogPanel 的某个 list 渲染逻辑、InteractionController 的 `me` getter。
- **风险**：纯编排器，最后做。如果前 3 步做得干净，B4 就是把 App 现有 `onMessage` 里的 30 行拆到一个独立 class，App 瘦到 <500 行。

## 每阶段 commit 模板

每个 C 阶段 commit 之前必做：
1. 跑 `pnpm -r test -- --run`（unit/integration）
2. 跑 `pnpm --filter @eldorado/client exec tsc --noEmit`
3. 跑 `pnpm --filter @eldorado/client exec vite build`
4. 跑 E2E：起 server + Playwright（桌面 viewport + 移动 iPhone viewport），走 lobby → game → AI turn → 玩家出牌 流程
5. 跑端到端 + 移动端截图确认无 regression

---

## 当前 App 文件状态

- `packages/client/src/main.ts`：1136 行（B1+B2+B3+B4+C1+C2+C3+C4 全部完成）
- `packages/client/src/controllers/`：9 个 controller
  - `MobileLayoutProbe.ts`：49 行（B0）
  - `HoverStateMachine.ts`：437 行（B1）
  - `ActionLogPanel.ts`：450 行（B2）
  - `InteractionController.ts`：934 行（B3）
  - `BoardCoordinator.ts`：163 行（B4）
  - `PlayerHandPanel.ts`（C1）
  - `OverlaysController.ts`（C2）
  - `SettingsMenuController.ts`（C3）
  - `SessionController.ts`：117 行（C4）

---

# Stage C — App god class 进一步拆分

> 2026-06-25 提出。B 阶段已完成 5 个 controller，把 App 从 2711 行降到 1387 行。
> 剩余 App 的 10 个 cluster 拆完预期 App ≤ 300 行，只剩「组合 + 生命周期」职责。

## 剩余 cluster 盘点（按行数从大到小）

| 集群 | 范围 | 行数 | 风险 |
|------|------|------|------|
| `renderHud` + 5 个 inline panel builder | 881–1152 | ~270 | 高 |
| `renderPlayerHandPanel` + preview popover | 740–841 | ~100 | 低 |
| `renderSettingsMenu` + toggle | 507–577 | ~70 | 低 |
| `onMessage` state-update switch | 243–311 | ~74 | 中 |
| `showSystemDialog` | 420–457 | ~38 | 低 |
| `attachSheetDismiss` | 606–639 | ~33 | 低 |
| `renderGameOverOverlay` | 1153–1162 | ~10 | 低 |
| `flash` + `flashTimer` | 578–591 | ~14 | 低 |
| `rejoinSavedSession` / `leaveRoom` / `clearRoomState` / `returnToLobby` / `onRoomClosed` | 317–419 | ~80 | 中 |
| `progressOf` / `closeMobilePanel` / `toggleViewMode` / `setViewMode` | 489–857 | ~50 | 低 |

合计 ≈ 740 行外加 6 个字段，全部抽完后 App 仅剩 `constructor` / `onMessage` 薄壳 / `renderHud` 组合器 / `onSocketEvent` / `preloadGameEngine` / 字段声明，预期 ≤ 300 行。

---

## C1. PlayerHandPanel（低风险，建议先做）

- **位置**：`packages/client/src/controllers/PlayerHandPanel.ts`（新文件）
- **字段**（2 个）：
  - `playerHandPanel: HTMLElement`
  - `pinnedPlayerId: string | null`
- **方法**（~6 个）：
  - `togglePlayerHand(playerId)`
  - `closePlayerHandPanel()`
  - `renderPlayerHandPanel()`
  - `renderPreviewPopover()`（内部辅助，给 hand card 显示使用规则）
  - `positionPopover(rect)` / `isPinned(playerId)`（已有的 `isPinned` 在 HoverHost 里被使用，搬过去后 App 上保留 forwarder）
- **依赖**：`you`, `state`, `mobileLayout.isMobileDevice`, `attachPreview`, `showPreview`, `interact.tryActOnHex`（用于手牌点击 → 出牌）。
- **风险**：低。和 HoverStateMachine / ActionLogPanel 的 panel-builder 模式一致，字段也少。
- **commit 信息**：把字段、3 个方法、`playerHandEls: Map<id, HTMLElement>` 一起搬走，App 上保留 2 个 forwarder。

## C2. OverlaysController（低-中风险，覆盖 4 个独立子系统）

- **位置**：`packages/client/src/controllers/OverlaysController.ts`（新文件）
- **覆盖的 cluster**：
  1. `flash(msg)` + `flashTimer`（13 行 + 1 字段）
  2. `showSystemDialog(title, message)` + `systemDialog` 字段（38 行 + 1 字段）
  3. `attachSheetDismiss(panel)`（33 行）
  4. `renderGameOverOverlay(state)`（10 行）
- **Host 接口**：
  - `state: GameState`
  - `hud: HTMLElement`
  - `returnToLobby(): void`
  - `leaveRoom(): void`
- **风险**：低-中。四个 cluster 没有共享状态，但都依赖 `this.hud.appendChild` + 一些回调。一次性合并到一个 class 比分两次做更省事。
- **建议**：一次性做完，单个 commit。

## C3. SettingsMenuController（低风险）

- **位置**：`packages/client/src/controllers/SettingsMenuController.ts`（新文件）
- **字段**（1 个）：`settingsOpen: boolean`
- **方法**（4 个）：
  - `toggleSettings()`
  - `renderSettingsMenu(state)`（~65 行，最大块）
  - `toggleViewMode()`
  - `setViewMode(mode)`
- **依赖**：`state`, `room`, `viewMode`, `aiDelay`, `mobileLayout`, `act`（设置面板里的 AI 延迟条调 `act({ type: 'setAiDelay', ms })`）
- **风险**：低。settings menu 是纯 UI；view-mode 切换是 localStorage + 类名，没有副作用。
- **注意**：`viewMode` 字段目前在 App 上是 `public`，被 Board 场景读取（不通过 host interface）。抽走后保留 App 上的 `getViewMode()` getter，Board 通过 host 读取。

## ✅ C4. SessionController（已完成 · commit `6ebc837`）

- **位置**：`packages/client/src/controllers/SessionController.ts` · 117 行
- **覆盖**（~80 行）：
  - `onSocketEvent(e)`
  - `rejoinSavedSession()`
  - `leaveRoom()`
  - `clearRoomState()`
  - `returnToLobby()`
  - `onRoomClosed(message)`
  - `closeMobilePanel()`（11 行，4 个 panel 都关闭）
- **依赖**：`store`, `net`, `lobbyCtl`, `state`, `room`, `you`, `error`, `mobilePanel`, `hud`, `pinnedPlayerId`（最后一条给 PlayerHandPanel 重置）。
- **Host 接口**：暴露 `close()` 给 PlayerHandPanel（`SessionHost.playerHandCtl.close()` 在 `clearRoomState` 里调用）。App 上保留 forwarder 给其它 controller（如 `actionLogPanel.resetActionLog()`）。
- **风险**：中。它桥接 network layer 和 UI 状态。最大的不确定性是其它 controller 暂时需要从 App 读 `room` / `you` / `state` —— 抽完后这部分从 `host` 上读。
- **实际改动**：把 `interaction` / `boardCtl` / `actionLogPanel` / `lobbyCtl` / `onMessage` 从 `private` 提升为 `readonly`（host interface 需要这些访问点）。App：1387 → 1136 行（-251）。

## C5. progressOf 提到 core（顺手做，低风险）

- **位置**：`packages/core/src/progress.ts`（新文件） + 在 main.ts 内联删除。
- **行数**：17 行纯函数：`progressOf(p: { position: Axial; finished: boolean }): number`
- **依赖**：纯计算，不依赖任何 state。
- **注意**：这个名字在客户端和潜在的 server 端都需要，做成纯函数 export 出去可以让 server-side analytics（如果以后做）也复用。
- **风险**：极低。

## C6. onMessage 拆薄壳（机械重构，低风险）

- **位置**：`packages/client/src/main.ts`（不新建文件）
- **改动**：把现有 74 行的 `onMessage` 改成 ~20 行的 switch 派发器，每个 case 调对应 controller 的 `applyMessage(msg)` 方法。
  - `bought` / `marketPromoted` → `actionLogPanel.applyMessage(msg)`
  - `state` → `sessionCtl.onStateUpdate(state)`（session-level 状态机更新）
  - `lobbyUpdate` / `joined` / `left` → `sessionCtl.applyMessage(msg)`
  - `error` / `kicked` / `closed` → `sessionCtl.applyMessage(msg)`
  - 其余本地状态（previousState → actionLog.appendActionLog）直接留在 onMessage 头尾。
- **风险**：低。需要先做 C1–C4 才能让 controller 都有 `applyMessage`。机械重构，不改行为。
- **预期效果**：App 上的 `onMessage` 从 74 行降到 ~30 行。

## C7. renderHud 拆分（高风险，建议最后做）

- **目标**：把 `renderHud` 内部的 5 个 panel builder 各自抽到 `packages/client/src/views/hud/<Panel>.ts` 作为纯函数，让 `renderHud` 退化为「组装 + 顺序管理」的 30–50 行壳。
- **要拆的 5 个 panel**：
  1. **PlayersPanel**（行 921–965）→ `views/hud/PlayersPanel.ts`，导出 `buildPlayersPanel(input): HTMLElement`
  2. **MarketPanel**（行 966–1015）→ `views/hud/MarketPanel.ts`，导出 `buildMarketPanel(input): HTMLElement`
  3. **HandPanel**（行 1018–1050）→ `views/hud/HandPanel.ts`，导出 `buildHandPanel(input): HTMLElement`
  4. **TurnInfoPanel**（行 1075–1145）→ `views/hud/TurnInfoPanel.ts`，导出 `buildTurnInfoPanel(input): HTMLElement`
  5. **TopBar + SettingsDock**（行 900–920）→ `views/hud/TopBar.ts`
- **Input 数据结构**：每个 builder 接一个 `input` 对象，**不持有状态**。所有回调（`onCardClick`、`confirmBuy` 等）通过 input 传入，builder 内部只调 `input.onXxx(...)`。
- **优点**：
  - 测试时可以直接调 `buildHandPanel(input)` 拿到 HTMLElement，不需要构造 App。
  - App 不再持有 ~20 个 `turnActionCard` / `turnCost` / `turnCoinHave` 之类的临时变量——它们移到 TurnInfoPanel 的 input 构造里。
  - 后续要把 HUD 整体重写为 React 组件时，5 个 builder 可以一对一映射。
- **风险**：
  - **高**。renderHud 是 App 中耦合最深的函数，270 行 + ~30 个 input 字段。
  - 需要先把 input 数据结构设计清楚（建议单独写一个 `views/hud/types.ts` 定义 `PlayersPanelInput` 等）。
  - 不建议一上来就把 5 个 panel 一起拆。建议分两次：
    - **C7a**：先抽 1 个最简单的（PlayersPanel）跑通流程，验证 host interface 模式在 panel 上也好用。
    - **C7b**：剩下的 4 个 panel 一次性抽完。
- **预期效果**：renderHud 从 270 行降到 ~40 行；App 总规模从 C6 后的 ~600 行降到 ~300 行。

## C1–C7 完成后的 App 形态

- `packages/client/src/main.ts`：约 300 行
  - 字段声明：~30 行（viewMode / aiDelay / hud / store / lobbyCtl / preview / terrainPanel / 各 controller 实例 + 5 个 DOM Map）
  - `constructor`：~40 行（装配 controller + 注册 socket event）
  - `onMessage`：~30 行（薄壳派发）
  - `renderHud`：~40 行（组装 5 个 panel builder）
  - `onSocketEvent`：~10 行（forward 到 SessionController）
  - `preloadGameEngine / start`：~40 行（bootstrap）
- `packages/client/src/controllers/`：从 5 个增加到 9 个
- `packages/client/src/views/hud/`：新目录，5 个 panel builder
- 总客户端代码量增加约 10–15%（每个 controller 多了 host interface + 构造 boilerplate），但**每个文件 ≤ 450 行**，可读性显著提升。

---

# Stage E — InteractionController 内部 7 个纯 helper 上提到 core（独立阶段）

> 这是个横切关注点，不属于 App 拆分。InteractionController.ts 里有 7 个纯函数是从 main.ts 搬过来时内联的：
>
> - `sameCoord(a, b)`
> - `isFinishEntrance(hex)`
> - `terrainSymbol(hex, state)` / `terrainSymbol(blockade, state)`
> - `blockadeMoveSymbol(blockade)` / `blockadeRequiresDiscard(blockade)`
> - `requiredFor(to, state, from, power?)`
> - `stepCost(hex, symbol, power)`
> - `cardDefId(cardId, state)`
>
> 它们都被 `HoverStateMachine` / `ActionLogPanel` 间接需要（通过 host interface 转发），未来如果 server 想做合法性校验也得用。
>
> 建议下一轮专门做一个 Stage E commit 批次，把它们搬到 `packages/core/src/movement/` 或类似目录，添加 unit test，然后让 HoverStateMachine / InteractionController 都从 core import。

---

## 不再计划做的事（明确跳过）

- **Stage D**：把 `core/` 的 `Player` interface 升 class 会破坏 `JSON.parse(JSON.stringify(state))` 的 clone 契约，会让 126 个 core 测试全部失效。已于 2026-06-24 取得用户明确同意跳过。