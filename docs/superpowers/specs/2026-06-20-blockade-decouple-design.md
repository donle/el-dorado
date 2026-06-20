# 边障碍「先移除、后移动」解耦 — 设计文档

日期：2026-06-20
分支：feat/json-map-architecture

## 背景

边与边之间的「连接地形障碍」（blockade，覆盖若干 hex 边的 Z 形接缝）目前**原子跨越**：

- **符号障碍**（green/blue/yellow，有 `symbol`）：`stepTo` 里一步完成——一张移动牌须同时覆盖 `blockade.cost + 对面地形 cost`，且单一符号同时满足接缝符号和对面地形符号（不同则无法跨越）；占领障碍并移动到对面格（engine.ts:249-277）。
- **碎石/弃牌障碍**（`terrain==='rubble'` 或无符号）：`clearSpace` 里弃掉正好 `blockade.cost` 张牌，占领并移动到对面格（engine.ts:290-307）。

障碍被任意玩家占领（`claimedBy`）后即「打开」，之后 `stepTo` 只按对面地形正常收费。

## 目标

把**移除**和**移动**解耦：付出障碍消耗→占领/打开障碍→**棋子留在原地**；之后对面格按它**自己的地形**要求单独走一步过去。并把「移除」作为链式多牌移动里的一个独立环节。

## 决策（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| 移除后棋子位置 | **留在原地**，之后单独走过去 |
| 适用范围 | **符号障碍 + 碎石(弃牌)障碍** 都解耦 |
| 符号障碍移除的力量扣除 | 只扣 `blockade.cost`，**activeMover 剩余力量保留**可继续 |
| 点被未占领障碍挡住的对面格 | **提示需先点障碍移除**，不自动移动 |
| 范围边界 | 只改**边障碍**；碎石/基地**地格**（进入地格本身的清除）保持现状 |

## 引擎设计（`@eldorado/core`）

### 新动作 `RemoveBlockade`
`actions.ts`：
```ts
| { type: 'RemoveBlockade'; blockadeId: string; cardIds?: string[] }
```
事件：复用既有 `blockadeClaimed`（`claimBlockade` 已 emit，engine.ts:138）；无需新增事件。

`engine.ts` 新增 `removeBlockade(state, playerId, blockadeId, cardIds, events)`：
1. 取 `blockade`；若不存在或已 `claimedBy` → `RuleError`。
2. 校验棋子在该障碍覆盖的某条边旁（`blockadeBetween(p.position, 对面hex)` 命中该 blockade；即玩家与某条 edge 相邻）。
3. **碎石/弃牌障碍**（`blockadeRequiresDiscard`）：
   - `cardIds.length === blockade.cost`，否则 `RuleError('需要正好选择 N 张牌')`。
   - 逐张 `takeFromHand` → `p.discard.push`。
   - `claimBlockade(p, blockade, events)`。**不移动**，**不动 activeMover**。
4. **符号障碍**：
   - 需要 `turn.activeMover` 且 `mover.symbol === blockadeMoveSymbol(blockade)` 且 `mover.remaining >= blockade.cost`，否则 `RuleError('需要X且力量≥N才能移除连接地形')`。
   - `mover.remaining -= blockade.cost`（**剩余保留**）。
   - `claimBlockade`。**不移动**。

> 客户端负责在符号障碍无合适 mover 时先 `pickHandMover(seamSym, blockade.cost, 选中在手牌)` → `PlayMovementCard` → `RemoveBlockade`。

### 修改 `stepTo`
- 删除「未占领 blockade 时按 `blockade.cost + destDeduct` 原子跨越」分支（engine.ts:249-277 的 blockade 段）。
- 改为：若 `blockadeBetween(p.position, hex)` 命中且 `!claimedBy` → `throw new RuleError('需要先移除连接地形障碍')`。
- 已占领（或无 blockade）→ 按对面地形正常收费（现有逻辑保留）。

### 修改 `clearSpace`
- 删除开头「blockade && !claimed」那一支（移交给 `RemoveBlockade`）。
- 保留并只处理**碎石/基地地格**（进入并清除地格本身）。`clearSpace` 此后只用于 `terrain==='rubble'|'basecamp'` 的目的地格。

### `dispatch`
新增 `case 'RemoveBlockade'`。

## AI（`ai.ts`）
- 处理障碍的计划（ai.ts:139-140、191-193、206-207、228、270-277）：把「原子跨越」改成**先 `RemoveBlockade` 再 `StepTo`**。
  - 符号障碍：能力评估为「有匹配符号且总力量 ≥ blockade.cost + 对面地形 cost」；计划里 `PlayMovementCard` → `RemoveBlockade` → `StepTo`（同一 mover 剩余力量走对面，或另起一张）。
  - 弃牌障碍：`RemoveBlockade{cardIds: N张}` → `PlayMovementCard`+`StepTo` 走对面。
- 保持计划末尾仍是 `EndTurn`。

## 客户端（`main.ts`）

### `tryActOnBlockade`（点障碍 → 移除）
- 移除 guard 里的旧分支；统一为「未占领障碍 → 移除（留原地）」：
  - **碎石/弃牌障碍**：进入 `clear` 选牌态（沿用 `startBlockadeClear` 的选牌 UI），选满 `blockade.cost` 张 → `RemoveBlockade{cardIds}`（不再 `ClearSpace`+移动）。
  - **符号障碍**：先续用 activeMover（符号匹配且 `remaining≥cost`）直接 `RemoveBlockade`；否则 `pickHandMover(seamSym, blockade.cost, 选中在手牌)` → `PlayMovementCard` → `RemoveBlockade`；选中牌打出后从 `selected` 移除，其余保留。
- 已占领障碍：点它 → 当作正常跨越（对面格 `StepTo`，现有 activeMover/pickHandMover 路径）。

### `tryActOnHex`（点对面格）
- 若 `blockadeBetween(me, hex)` 命中且未占领 → `flash('先点连接地形移除障碍')`，`return true`（不移动）。
- 否则现有移动逻辑不变。

### `recomputeHighlights`
- 未占领障碍：可移除即高亮（符号障碍按选中/mover 能否付 `blockade.cost` 判定，用新的 `canRemoveBlockade`；弃牌障碍按手牌数 ≥ cost）。沿用现有 `setBlockadeHighlights`。
- 移除后对面格按地形高亮（已占领 → 正常 `canEnter`）。

### `ClearSpace` 调用点
- `onCardClick` 的 `clear` 态：当 `clearBlockadeId` 存在时改发 `RemoveBlockade{blockadeId, cardIds}`；当是地格清除（`clearTarget` 无 blockade）时仍发 `ClearSpace`。

## 涉及文件
| 文件 | 改动 |
| --- | --- |
| `packages/core/src/actions.ts` | 加 `RemoveBlockade` 动作 + `blockadeRemoved` 事件 |
| `packages/core/src/engine.ts` | 新增 `removeBlockade()`；改 `stepTo`、`clearSpace`；`dispatch` 加分支 |
| `packages/core/src/ai.ts` | 障碍计划改为「先移除再走」 |
| `packages/client/src/main.ts` | `tryActOnBlockade`/`tryActOnHex`/`recomputeHighlights`/clear 态提交 |

## 测试
- `engine.test.ts`：
  - 改「seam crossing charges blockade + destination terrain」「requires discarding cards to claim a rubble blockade」为两步（RemoveBlockade 留原地 → StepTo 走对面）。
  - 新增：符号障碍 RemoveBlockade 只扣 cost、剩余力量保留、占领、不移动；力量不足/符号不符报错；弃牌障碍 RemoveBlockade 弃 N 张占领不移动、张数不符报错；已占领障碍 stepTo 正常；未占领障碍 stepTo 报「需先移除」。
- `ai.test.ts`：现有用例保持；如局面涉及障碍，验证计划含 RemoveBlockade 在 StepTo 之前。
- 客户端：手动验证（控制器跑应用）——点符号障碍移除留原地、再走对面；点碎石障碍选牌移除；点被挡对面格提示。

## 不做（YAGNI）
- 不解耦碎石/基地**地格**进入（仍是进入并清除地格本身）。
- 不做障碍移除的撤销。
- 不引入「移除并移动」一步动作（链式逐格点击即可）。
