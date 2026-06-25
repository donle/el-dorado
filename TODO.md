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

## 当前文件状态

- `packages/client/src/main.ts`：**1039 行**（仍是 god class）
- `packages/client/src/scene/Board.ts`：**1515 行**（仍是 god class）
- `packages/core/src/engine.ts`：**~480 行**（state machine + reducer，体积已收住）

### main.ts 内部尚未拆出的 cluster（≤ 300 行目标）

按体量从大到小：

| 集群 | 范围（行） | 行数 | 风险 |
|------|-----------|------|------|
| `renderHud` 内部剩余 orchestration | renderHud body | ~200 | 高 |
| `onSocketEvent` | socket 转发 | ~30 | 低 |
| `preloadGameEngine` / `start` / `setupRejoinGuard` | bootstrap | ~50 | 低 |
| 字段声明（viewMode / aiDelay / hud / 各 controller） | top of class | ~30 | — |
| 其余（togglePlayerHand 包装、context-menu、panel 装配 helper） | 散布 | ~50 | 低 |

合计 ≈ 740 行 → 全部抽完后 App 仅剩 `constructor` / `onMessage` 薄壳 / `renderHud` 组合器 / `onSocketEvent` / `preloadGameEngine` / 字段声明，预期 ≤ 300 行。

> **没有 pending 的具体 task**：剩余拆分属于另一轮独立计划（参考 [[project-god-class-state-2026-06]]），不在本 TODO 范围。

---

## 不再计划做的事（明确跳过）

- **Stage D**：把 `core/` 的 `Player` interface 升 class 会破坏 `JSON.parse(JSON.stringify(state))` 的 clone 契约，会让 126 个 core 测试全部失效。已于 2026-06-24 取得用户明确同意跳过。