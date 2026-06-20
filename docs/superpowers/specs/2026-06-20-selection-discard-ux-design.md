# 选择与弃牌交互优化 — 设计文档

日期：2026-06-20
分支：feat/json-map-architecture

## 背景

当前客户端（`packages/client/src/main.ts`）的购买与弃牌交互有两处可优化：

1. **购买选牌会被重置**：点市场牌进入买入模式时 `onMarketClick` 会 `this.payment.clear()`（main.ts:525），切换/重选市场牌就会丢掉已选好的付款手牌。
2. **弃牌是三步且绑死结束回合**：弃牌走「弃牌…（进入模式）→ 选牌 → 弃 N 张并结束」三步，且通过 `EndTurn` 的 `discardCardIds` 完成（main.ts:922–923、engine.ts:98/501），没有独立弃牌，也没有每回合次数限制。

游戏已有按回合追踪的先例：`turn.hasBought`（types.ts:164，engine.ts:346/376）。

## 目标

- **功能 1**：购买时切换市场牌不清空已选手牌，够不够买实时重算。
- **功能 2**：弃牌改为「每回合一次」的独立技能 —— 不补牌、不结束回合、用完置灰。

## 决策（已与用户确认）

| 决策点 | 选择 |
| --- | --- |
| 弃牌后是否补牌 | **不补牌**（回合结束时仍会补满到 4 张，保持手牌循环） |
| 与结束回合的关系 | **完全独立**；`EndTurn` 不再带弃牌选择 |
| 购买选牌交互 | **切换市场牌不清空选择**，保留「先点市场牌进入买入」的入口 |
| 弃牌点击交互 | **先选后确认**：进入模式 → 多选手牌 → 点「弃掉(N)」一次性弃掉 |

## 功能 1 — 购买选牌：切换市场牌不清空选择

**改动：`onMarketClick`（main.ts:516–531）**

- 删除切换目标时的 `this.payment.clear()`。
- 仅在**完全退出**买入模式（再次点同一张市场牌 → 回到 `idle`）时清空 `payment`。
- 切换到另一张市场牌时保留 `payment`；`renderHud` 已实时计算 `have/cost`（main.ts:907–911），「确认购买」按钮会按新价格自动启用/禁用。

伪代码：

```ts
private onMarketClick(defId: string): void {
  if (!this.isMyTurn()) return;
  if (this.state!.turn?.hasBought) { this.flash('本回合已购买 · 每回合限买 1 张'); return; }
  this.mode = this.buyTargetDefId === defId ? 'idle' : 'buy';
  this.buyTargetDefId = this.mode === 'buy' ? defId : null;
  this.selectedCardId = null;
  if (this.mode !== 'buy') this.payment.clear(); // 仅退出买入模式时清空
  this.hint = this.mode === 'buy' ? '选手牌支付，然后点「确认购买」' : '';
  if (this.mode === 'buy') this.mobilePanel = null;
  this.renderHud();
  this.recomputeHighlights();
}
```

不变项：`selectedCardId` 仍清空（进入买入模式时取消移动选择）；移动牌单选逻辑不动。

## 功能 2 — 弃牌：每回合一次的独立技能

### 核心（`@eldorado/core`）

**`actions.ts`**
- 新增动作：`{ type: 'DiscardCards'; cardIds: string[] }`。
- 从 `EndTurn` 移除 `discardCardIds`：`{ type: 'EndTurn' }`。
- 新增事件：`{ type: 'discarded'; playerId: string; count: number }`。

**`types.ts`（TurnState，line 155）**
- 新增 `hasDiscarded: boolean`。

**`engine.ts`**
- `dispatch`（line 85）：新增 `case 'DiscardCards'`。
- 新增 `discardCards(state, playerId, cardIds, events)`：
  - 校验是本人回合（沿用既有 `player()` / 回合校验路径）。
  - 若 `turn.hasDiscarded` → `throw new RuleError('本回合已经弃过牌')`。
  - 对每个 id：`takeFromHand(p, id)` → `p.discard.push(card)`。
  - `turn.hasDiscarded = true`；push `{ type: 'discarded', playerId, count }`。
  - **不抽牌。**
- `endTurn`（line 491）：删除参数 `discardCardIds` 及其弃牌循环（line 501–504）；其余（结算 inPlay、补满到 `HAND_SIZE`、`advanceTurn`）不变。
- `advanceTurn`（line 537）：新建 turn 时加 `hasDiscarded: false`。

**`setup.ts`（line 97）**
- 初始 turn 加 `hasDiscarded: false`。

**`ai.ts`（line 342–343）**
- 当前：`{ type: 'EndTurn', discardCardIds }`。
- 改为：若有要弃的牌，先 push `{ type: 'DiscardCards', cardIds }`，再 push `{ type: 'EndTurn' }`。
- 最后一个动作仍是 `EndTurn`，`ai.test.ts:53` 不受影响。

### 客户端（`main.ts`）

**动作条（renderHud，main.ts:916–936）**

非弃牌模式（idle 等）时：
- 「结束回合」按钮：`this.act({ type: 'EndTurn' })`（去掉 discard 选择）。
- 「弃牌」技能按钮：
  - 若 `turn.hasDiscarded` → `disabled`，文字「已弃牌」。
  - 否则点击 → 进入 `discard` 模式，`discardSet.clear()`，提示「点要弃的手牌，再点『弃掉』确认」。

弃牌模式（`mode === 'discard'`）时：
- 「弃掉 (N)」按钮（`N = discardSet.size`，N=0 时禁用）→ `this.act({ type: 'DiscardCards', cardIds: [...this.discardSet] })`。
- 「全部」快捷键（可选，沿用现有「全部弃掉」选中全部手牌）。
- 「取消」→ `cancelMode()`。

**选牌（onCardClick，main.ts:502–506）**：`mode === 'discard'` 分支保持不变（点手牌切换进/出 `discardSet`，`discarding` 高亮）。

**状态复用**：`discardSet`、`mode='discard'`、`resetSelection()` 均已存在，无需新增客户端状态。服务器回包后 `resetSelection()` 会退出弃牌模式（main.ts:163）。

## 涉及文件

| 文件 | 改动 |
| --- | --- |
| `packages/core/src/actions.ts` | 加 `DiscardCards`、`discarded`；`EndTurn` 去掉 `discardCardIds` |
| `packages/core/src/types.ts` | `TurnState.hasDiscarded` |
| `packages/core/src/engine.ts` | `dispatch` 加分支；新增 `discardCards()`；`endTurn` 去弃牌；两处 turn 初始化 |
| `packages/core/src/setup.ts` | 初始 turn 加 `hasDiscarded` |
| `packages/core/src/ai.ts` | 弃牌改为独立 `DiscardCards` 动作 |
| `packages/client/src/main.ts` | `onMarketClick` 保留选择；弃牌技能按钮 + 模式提交 |

## 测试

- `engine.test.ts`：新增 —— DiscardCards 移牌到弃牌堆、不抽牌、第二次弃牌报错（`hasDiscarded`）、非本人回合报错；`EndTurn` 不再弃牌。
- `ai.test.ts`：现有「无牌可弃仍结束回合」用例保持通过；可加一例验证有牌时计划包含 `DiscardCards`。
- 现有用例：无任何用例使用 `EndTurn.discardCardIds`，移除该字段安全。

## 不做（YAGNI）

- 不做购买的「先选手牌再点市场」全新多选交互（与移动单选冲突，且当前需求不需要）。
- 弃牌技能不补牌、不做撤销。
- 不改移动 / 清理碎石 / 能力卡交互。
