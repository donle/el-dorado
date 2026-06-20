# 选择与弃牌交互优化 — 设计文档

日期：2026-06-20
分支：feat/json-map-architecture

> **2026-06-20 修订（v2）**：原 v1 把购买/弃牌当作各自独立的「模式」。经与用户确认，真实需求是一个**统一的手牌多选模型** + **多牌连续移动**。v2 修订见文末「## 修订 v2」一节，它取代 v1 的「功能 1 购买选牌」与「功能 2 的弃牌交互（UI 部分）」。v1 已落地且保留的部分：核心 `DiscardCards` 动作、脱离 `EndTurn`、AI 迁移（不受 v2 影响）。

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

- 弃牌技能不补牌、不做撤销。

---

## 修订 v2 — 统一手牌多选 + 多牌连走

### 动机
v1 把购买、弃牌当作互斥「模式」，且移动仍是单选。用户澄清真实需求：**手牌是一个统一多选集**，选好之后由「点的目标」决定这批牌干什么——点市场牌去购买、点相邻格去移动、点弃牌键去弃掉。这同时更自然地满足了 v1 的原始诉求（选好牌点市场不丢选择 / 选好牌点弃牌直接丢）。

### 已与用户确认的决策（v2）
| 决策点 | 选择 |
| --- | --- |
| 手牌选择 | 统一多选集 `selected`，回合内点手牌即切换选中，无「买入/弃牌模式」 |
| 移动语义 | 多张移动牌**依次连着走**（逐格点击，客户端按需消耗选中的牌） |
| 移动触发 | **逐格点击相邻格**，每步客户端自动从选中牌里挑牌付费；不做自动寻路 |
| 最省挑牌策略 | **续用当前牌(activeMover) > 单符号牌 > 同类中溢出最小(power−deduct 最小)** |
| 走不动的终止态 | 选中牌即使没用完，若没有牌能付当前步，则停下、提示，不强行出牌 |
| 购买确认 | 保留「确认购买」按钮（显示 have/cost），不自动成交 |
| 弃牌 | 弃牌技能键 = 弃掉当前 `selected`（每回合一次，沿用 v1 的 `DiscardCards` + `hasDiscarded`） |
| 引擎 | **不改**——多牌连走由客户端用既有 `PlayMovementCard`/`StepTo`/`activeMover` 编排 |

### 统一选牌状态（客户端 `main.ts`）
- 用单一 `selected: Set<string>`（手牌 id）**替换** `selectedCardId`、`payment`、`discardSet`。
- 保留 `buyTargetDefId: string|null`、`clearTarget`、`clearBlockadeId`。
- `mode` 仅保留「清除碎石」这一态（由 `clearTarget != null` 表达即可）；购买由 `buyTargetDefId` 表达；弃牌无模式。
- `resetSelection()` 清空 `selected`、`buyTargetDefId`、`clearTarget`、`clearBlockadeId`（服务器每次回包后调用）。

### 最省挑牌：core 纯函数 + 单测
把「最省挑牌」做成 core 里的纯函数，便于 vitest 单测：

```ts
// packages/core/src/movement.ts （新文件）
// 在候选手牌中按「单符号优先、溢出最小」挑一张能付这一步的牌。
// 调用方负责先尝试续用 activeMover（零浪费），失败再调本函数。
export function pickHandMover(
  req: MoveSymbol | null,   // 该步要求的符号；null = 通配(如黄金城/起点)
  deduct: number,           // 该步消耗点数
  candidates: { id: string; defId: string }[],  // 选中且仍在手的牌
): { cardId: string; symbol: MoveSymbol } | null
```

挑选规则：
1. 候选过滤：卡的 `movableSymbols` 含 `req`（`req===null` 时任一符号皆可），且 `power >= deduct`。
2. 排序键：先按 `movableSymbols(defId).length` 升序（单符号优先），再按 `power` 升序（溢出最小）；稳定取第一。
3. 选中卡的 `symbol`：`req !== null` 时取 `req`；`req === null` 时取该卡 `movableSymbols[0]`。
4. 无候选 → 返回 `null`（终止态）。

### 移动编排（客户端，逐格）
点相邻格/连接地形时，求出该步 `{required, deduct}`（沿用 `movementRequirement`/`canEnter`/blockade 逻辑）后：
1. 若 `activeMover` 符号匹配且剩余够 → `StepTo`（最省，零额外消耗）。
2. 否则 `pickHandMover(required, deduct, 选中且在手的牌)`：
   - 命中 → `PlayMovementCard{cardId,symbol}` 然后 `StepTo`；从 `selected` 移除该已打出牌。
   - 返回 null → 提示「无牌可走」，不出牌（终止态）。

### 高亮（recomputeHighlights）
- 清除碎石态：不显示移动高亮。
- 有 `activeMover` 且剩余>0：高亮它能进的相邻格/连接地形。
- 否则：高亮**任一选中移动牌**能进的相邻格/连接地形（选中变化实时更新）。
- 可清除的相邻碎石/基地格始终高亮。

### 动作条（renderHud）
- 始终：`结束回合`（`{type:'EndTurn'}`）；`弃牌` 技能键（`hasDiscarded` 时禁用，否则 `DiscardCards{cardIds:[...selected]}`，要求 `selected` 非空）。
- 选了市场目标（`buyTargetDefId`）：`确认购买 (have/cost💰)`（`BuyCard{defId, paymentCardIds:[...selected]}`，have<cost 时禁用）。
- 清除碎石态：`取消`。

### 对 v1 已提交工作的影响
- **保留**：core `DiscardCards` + 脱离 `EndTurn` + AI 迁移（Task 1、4 已提交，不改）。
- **取代/重做**：v1 客户端 Task 2（`onMarketClick` 保留选择）、Task 3（弃牌模式 UI）被本节统一模型整体重写。

### v2 涉及文件
| 文件 | 改动 |
| --- | --- |
| `packages/core/src/movement.ts`（新） | `pickHandMover` 纯函数 |
| `packages/core/test/movement.test.ts`（新） | `pickHandMover` 单测（单/多符号、溢出最小、通配、无候选） |
| `packages/client/src/main.ts` | 统一 `selected`；重写 `onCardClick`/`onMarketClick`/`confirmBuy`/`tryActOnHex`/`tryActOnBlockade`/`recomputeHighlights`/动作条/`resetSelection`；移除 `selectedCardId`/`payment`/`discardSet`/buy&discard 的 `mode` |

### v2 不做（YAGNI）
- 不做跨整条路径的全局最优分配（寻路+背包）；逐格贪心即可，路径由玩家点击控制。
- 引擎不改；不引入多牌单动作。
