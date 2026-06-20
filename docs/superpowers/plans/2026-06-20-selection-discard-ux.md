# 选择与弃牌交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 购买时切换市场牌不再清空已选手牌；弃牌改为每回合一次、不补牌、不结束回合的独立技能。

**Architecture:** 核心层（`@eldorado/core`）新增 `DiscardCards` 动作与 `turn.hasDiscarded` 状态，弃牌脱离 `EndTurn`；AI 同步改用独立弃牌动作。客户端 `main.ts` 改 `onMarketClick` 保留付款选择，并把弃牌做成常驻技能按钮。任务按「保证每次提交都能编译通过」的顺序排列：先加新动作（additive），客户端切到新动作，最后再删除 `EndTurn` 上的旧弃牌字段。

**Tech Stack:** TypeScript, pnpm workspaces, Vitest（core 测试），Vite + tsc（client 构建）。设计文档见 `docs/superpowers/specs/2026-06-20-selection-discard-ux-design.md`。

## Global Constraints

- 语言/工具：TypeScript 5.5；包管理 pnpm 11.5；ESM（`"type": "module"`，import 带 `.js` 后缀）。
- 核心规则违例一律 `throw new RuleError('中文提示')`；`applyAction` 已在入口校验「是否轮到该玩家」（engine.ts:67-69），动作内部无需再校验回合归属。
- 用户可见文案为简体中文，与现有 UI 一致（如「本回合已购买」「确认购买」）。
- 提交信息结尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 每回合限制沿用既有先例：`turn.hasBought`（types.ts:164）。

---

### Task 1: 核心 — 新增 `DiscardCards` 动作与 `hasDiscarded` 状态（additive）

本任务只做加法：新增动作、事件、回合状态与引擎处理，**不动** `EndTurn` 现有的弃牌逻辑（留到 Task 4），保证全仓库继续编译。

**Files:**
- Modify: `packages/core/src/actions.ts` (Action 联合类型、GameEvent 联合类型)
- Modify: `packages/core/src/types.ts:155-165` (TurnState)
- Modify: `packages/core/src/engine.ts` (dispatch ~line 85-99；新增 `discardCards()`；`advanceTurn` turn 初始化 ~line 537-542)
- Modify: `packages/core/src/setup.ts:97-102` (初始 turn)
- Modify: `packages/core/test/engine.test.ts:38-42` (setTurn 测试辅助里的 turn 字面量)
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Produces:
  - `type Action |= { type: 'DiscardCards'; cardIds: string[] }`
  - `type GameEvent |= { type: 'discarded'; playerId: string; count: number }`
  - `TurnState.hasDiscarded: boolean`
  - engine 内部 `function discardCards(state: GameState, playerId: string, cardIds: string[], events: GameEvent[]): void`
- Consumes: 既有 `player()`, `takeFromHand()`, `RuleError`（均在 engine.ts）。

- [ ] **Step 1: 写失败测试**

在 `packages/core/test/engine.test.ts` 末尾新增（`game`/`giveHand`/`placeAt`/`setTurn`/`run` 均为文件内既有辅助）：

```ts
describe('DiscardCards skill', () => {
  it('moves chosen cards to the discard pile without drawing', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer']);
    const before = s.players.find((p) => p.id === 'p0')!.deck.length;
    const r = run(s, 'p0', {
      type: 'DiscardCards',
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    const p = r.state.players.find((x) => x.id === 'p0')!;
    expect(r.result.ok).toBe(true);
    expect(p.hand.map((c) => c.id)).toEqual(['p0:traveller#t2', 'p0:photographer#t3']);
    expect(p.discard.map((c) => c.id)).toEqual(['p0:explorer#t0', 'p0:sailor#t1']);
    expect(p.deck.length).toBe(before); // 不补牌
    expect(r.state.turn!.hasDiscarded).toBe(true);
  });

  it('rejects a second discard in the same turn', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor']);
    let r = run(s, 'p0', { type: 'DiscardCards', cardIds: ['p0:explorer#t0'] });
    r = run(r.state, 'p0', { type: 'DiscardCards', cardIds: ['p0:sailor#t1'] });
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error).toContain('已经弃过牌');
  });

  it('rejects discarding a card not in hand', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer']);
    const r = run(s, 'p0', { type: 'DiscardCards', cardIds: ['p0:ghost#t9'] });
    expect(r.result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @eldorado/core test -- engine.test.ts`
Expected: FAIL（类型错误 / `DiscardCards` 不被 dispatch 识别）。

- [ ] **Step 3: 加动作与事件类型**

`packages/core/src/actions.ts` —— 在 Action 联合里 `EndTurn` 之前加一行，并在 GameEvent 联合里加 `discarded`：

```ts
  | { type: 'BuyCard'; defId: string; paymentCardIds: string[] }
  | { type: 'DiscardCards'; cardIds: string[] }
  | {
      type: 'UseAbility';
```

```ts
  | { type: 'bought'; playerId: string; defId: string }
  | { type: 'discarded'; playerId: string; count: number }
  | { type: 'ability'; playerId: string; cardId: string }
```

- [ ] **Step 4: 给 TurnState 加 `hasDiscarded`**

`packages/core/src/types.ts`（TurnState，line 163-164 附近）：

```ts
  /** Whether the player has already bought a card this turn. */
  hasBought: boolean;
  /** Whether the player has already used the discard skill this turn. */
  hasDiscarded: boolean;
}
```

- [ ] **Step 5: 初始化 `hasDiscarded`（三处 turn 字面量）**

`packages/core/src/setup.ts:97-102`：

```ts
    turn: {
      playerId: firstPlayer.id,
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
      hasDiscarded: false,
    },
```

`packages/core/src/engine.ts` `advanceTurn`（line 537-542）：

```ts
    state.turn = {
      playerId: candId,
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
      hasDiscarded: false,
    };
```

`packages/core/test/engine.test.ts` setTurn 辅助（line 38-42）：

```ts
  s.turn = {
    playerId: pid,
    inPlay: [],
    removedThisTurn: [],
    hasBought: false,
    hasDiscarded: false,
  };
```

- [ ] **Step 6: 加 dispatch 分支与 `discardCards()`**

`packages/core/src/engine.ts` dispatch（在 `case 'BuyCard'` 之后）：

```ts
    case 'BuyCard':
      return buyCard(state, playerId, action.defId, action.paymentCardIds, events);
    case 'DiscardCards':
      return discardCards(state, playerId, action.cardIds, events);
```

在 `buyCard` 函数之后（`// --- end of turn ---` 之前）新增：

```ts
// --- discard skill ---

function discardCards(
  state: GameState,
  playerId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  if (turn.hasDiscarded) throw new RuleError('本回合已经弃过牌');
  for (const id of cardIds) {
    p.discard.push(takeFromHand(p, id));
  }
  turn.hasDiscarded = true;
  events.push({ type: 'discarded', playerId, count: cardIds.length });
}
```

- [ ] **Step 7: 运行测试确认通过**

Run: `pnpm --filter @eldorado/core test -- engine.test.ts`
Expected: PASS（新增 3 个用例全过，其余不受影响）。

- [ ] **Step 8: 全核心测试 + 客户端编译自检**

Run: `pnpm --filter @eldorado/core test && pnpm --filter @eldorado/client build`
Expected: core 全绿；client `tsc` 通过（此时 `EndTurn.discardCardIds` 仍存在，客户端不受影响）。

- [ ] **Step 9: 提交**

```bash
git add packages/core/src/actions.ts packages/core/src/types.ts packages/core/src/engine.ts packages/core/src/setup.ts packages/core/test/engine.test.ts
git commit -m "feat(core): DiscardCards skill — once-per-turn, no redraw

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 客户端 — 购买时切换市场牌保留已选手牌

**Files:**
- Modify: `packages/client/src/main.ts:516-531` (`onMarketClick`)

**Interfaces:**
- Consumes: 既有 `this.mode`, `this.buyTargetDefId`, `this.payment`, `this.flash()`, `renderHud()`, `recomputeHighlights()`。
- Produces: 无新接口；行为变更。

- [ ] **Step 1: 改 `onMarketClick`**

`packages/client/src/main.ts:516-531`，把整段替换为（仅删除「切换目标时清空 payment」，改为只有退出买入模式才清空）：

```ts
  private onMarketClick(defId: string): void {
    if (!this.isMyTurn()) return;
    if (this.state!.turn?.hasBought) {
      this.flash('本回合已购买 · 每回合限买 1 张');
      return;
    }
    this.mode = this.buyTargetDefId === defId ? 'idle' : 'buy';
    this.buyTargetDefId = this.mode === 'buy' ? defId : null;
    this.selectedCardId = null;
    // 切换市场目标时保留已选付款手牌；仅退出买入模式才清空。
    if (this.mode !== 'buy') this.payment.clear();
    this.hint = this.mode === 'buy' ? '选手牌支付，然后点「确认购买」' : '';
    // On mobile, close the market sheet so the hand is reachable for payment.
    if (this.mode === 'buy') this.mobilePanel = null;
    this.renderHud();
    this.recomputeHighlights();
  }
```

- [ ] **Step 2: 编译自检**

Run: `pnpm --filter @eldorado/client build`
Expected: tsc + vite build 通过。

- [ ] **Step 3: 手动验证（开发服）**

Run: `pnpm dev:client`，开局轮到自己时：选若干手牌（在买入模式下点手牌）→ 点另一张市场牌切换目标 → 确认手牌选择仍在、「确认购买 (have/cost💰)」按钮按新价格实时启用/禁用；点同一张市场牌取消买入 → 选择被清空。

- [ ] **Step 4: 提交**

```bash
git add packages/client/src/main.ts
git commit -m "feat(client): keep payment selection when switching market target

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 客户端 — 弃牌技能按钮（先选后确认，不结束回合）

把动作条里的弃牌从「弃牌… → 选 → 弃 N 张并结束」改成常驻技能：armed → 选牌 → 「弃掉 (N)」立即弃掉且留在本回合；用过置灰。「结束回合」按钮改为不带弃牌。客户端从此不再发送 `EndTurn.discardCardIds`（字段本身留到 Task 4 删除）。

**Files:**
- Modify: `packages/client/src/main.ts:905-936` (renderHud 动作条 buy/discard/else 分支)

**Interfaces:**
- Consumes: `this.mode`, `this.discardSet`, `this.me`, `this.act()`, `button()`，新动作 `DiscardCards`（Task 1 已加），`this.state.turn.hasDiscarded`。
- Produces: 无新接口；UI 行为变更。

- [ ] **Step 1: 改动作条的 discard 分支与 else 分支**

`packages/client/src/main.ts`，把 `} else if (this.mode === 'discard') {` 整段（line 916-936，到 `else { 结束回合 + 弃牌… }` 结束）替换为：

```ts
      } else if (this.mode === 'discard') {
        const n = this.discardSet.size;
        const all = button('全部', () => {
          (this.me?.hand ?? []).forEach((c) => this.discardSet.add(c.id));
          this.renderHud();
        }, true);
        const done = button(`弃掉 (${n})`, () =>
          this.act({ type: 'DiscardCards', cardIds: [...this.discardSet] }),
        );
        done.disabled = n === 0;
        bar.appendChild(all);
        bar.appendChild(done);
        bar.appendChild(button('取消', () => this.cancelMode(), true));
      } else {
        bar.appendChild(button('结束回合', () => this.act({ type: 'EndTurn' }), true));
        const discarded = !!s.turn?.hasDiscarded;
        const skill = button(discarded ? '已弃牌' : '弃牌', () => {
          this.mode = 'discard';
          this.discardSet.clear();
          this.hint = '点要弃的手牌，再点「弃掉」确认（每回合一次）';
          this.renderHud();
        }, true);
        skill.disabled = discarded;
        bar.appendChild(skill);
      }
```

- [ ] **Step 2: 编译自检**

Run: `pnpm --filter @eldorado/client build`
Expected: 通过（`DiscardCards` 已存在；`EndTurn` 不再带 `discardCardIds`，仍合法因字段为可选）。

- [ ] **Step 3: 手动验证**

Run: `pnpm dev:client`。轮到自己：点「弃牌」→ 点几张手牌（高亮 discarding）→ 点「弃掉 (N)」→ 选中的牌进弃牌堆、手牌减少、**回合未结束**、「弃牌」按钮变灰显示「已弃牌」。再点「结束回合」正常进入下家、并补满到 4 张。

- [ ] **Step 4: 提交**

```bash
git add packages/client/src/main.ts
git commit -m "feat(client): discard as once-per-turn skill via DiscardCards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 核心 — 弃牌彻底脱离 `EndTurn`（清理 + AI 迁移）

删除 `EndTurn` 上的 `discardCardIds` 字段与 `endTurn()` 的弃牌循环；AI 改为在 `EndTurn` 前发独立 `DiscardCards`。完成后全仓库不再有任何 `discardCardIds` 引用。

**Files:**
- Modify: `packages/core/src/actions.ts:16` (EndTurn 类型)
- Modify: `packages/core/src/engine.ts:97-98` (dispatch EndTurn)、`491-521` (endTurn 签名与弃牌循环)
- Modify: `packages/core/src/ai.ts:340-344`
- Test: `packages/core/test/engine.test.ts`, `packages/core/test/ai.test.ts`

**Interfaces:**
- Produces: `type ... | { type: 'EndTurn' }`（去掉 `discardCardIds`）；`function endTurn(state, playerId, events)`（去掉 `discardCardIds` 参数）。
- Consumes: `DiscardCards`（Task 1）。

- [ ] **Step 1: 写/改测试（先失败）**

在 `packages/core/test/engine.test.ts` 的 `DiscardCards skill` describe 内追加一条「EndTurn 不再弃牌」用例：

```ts
  it('EndTurn no longer discards leftover hand cards', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer']);
    const r = run(s, 'p0', { type: 'EndTurn' });
    // 回合已切换；p0 的手牌不会因 EndTurn 被弃（仍是原 4 张，不再补抽）。
    const p = r.state.players.find((x) => x.id === 'p0')!;
    expect(r.result.ok).toBe(true);
    expect(p.discard.length).toBe(0);
    expect(p.hand).toHaveLength(4);
  });
```

在 `packages/core/test/ai.test.ts` 末尾追加（验证 AI 卡死时用独立弃牌动作）：

```ts
  it('emits a standalone DiscardCards before EndTurn when resting', () => {
    // 复用本文件构造「无法前进」局面的既有辅助（与 "rests" 用例同款 setup）。
    // 见 line 36 的用例：plan 应在 EndTurn 之前包含 DiscardCards。
  });
```

> 注：`ai.test.ts` 的具体局面构造请直接复用同文件 line 36「rests (discards hand)」用例的 setup 代码，把断言改为：
> ```ts
> const di = plan.findIndex((x) => x.type === 'DiscardCards');
> const ei = plan.findIndex((x) => x.type === 'EndTurn');
> expect(di).toBeGreaterThanOrEqual(0);
> expect(di).toBeLessThan(ei);
> expect(plan[plan.length - 1].type).toBe('EndTurn');
> ```
> 若该局面手牌为空（无可弃），改为断言 `plan` 不含 `DiscardCards` 且末位为 `EndTurn`（与既有 line 52-53 注释一致）。实现 Step 后据实选择其一。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @eldorado/core test`
Expected: 新「EndTurn no longer discards」用例 FAIL（当前 endTurn 仍会补抽到 4，且无弃牌不影响——失败点在补抽：`p.hand` 仍是 4 但 deck 被抽过；本用例聚焦 discard.length===0 应已通过，hand===4 取决于 endTurn 行为）。先跑一次记录实际失败信息，再进入实现。

- [ ] **Step 3: 删除 `EndTurn.discardCardIds`**

`packages/core/src/actions.ts:16`：

```ts
  | { type: 'EndTurn' };
```

- [ ] **Step 4: 改 dispatch 与 `endTurn()`**

`packages/core/src/engine.ts` dispatch（line 97-98）：

```ts
    case 'EndTurn':
      return endTurn(state, playerId, events);
```

`packages/core/src/engine.ts` `endTurn`（line 491-504），删掉 `discardCardIds` 参数与弃牌循环：

```ts
function endTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const p = player(state, playerId);
  const turn = state.turn!;

  // Resolve cards played this turn.
  for (const card of turn.inPlay) {
```

（保留其后的 inPlay 结算、补满到 `HAND_SIZE`、`advanceTurn` 不变。）

- [ ] **Step 5: 迁移 AI**

`packages/core/src/ai.ts:340-344`，替换为：

```ts
  // If we made no progress, rest: discard the (useless this turn) hand so we
  // draw a fresh one next turn. Without this a stuck hand never cycles.
  if (!moved) {
    const cardIds = available().map((c) => c.id);
    if (cardIds.length) actions.push({ type: 'DiscardCards', cardIds });
  }
  actions.push({ type: 'EndTurn' });
  return actions;
```

- [ ] **Step 6: 运行核心全测**

Run: `pnpm --filter @eldorado/core test`
Expected: 全 PASS（含新增的 EndTurn 与 AI 用例；既有 EndTurn 用例不受影响）。

- [ ] **Step 7: 全仓库无残留引用 + 客户端编译**

Run: `grep -rn "discardCardIds" packages && pnpm --filter @eldorado/client build`
Expected: `grep` 无输出（退出码非 0 也可接受，只要无匹配行）；client build 通过。

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/actions.ts packages/core/src/engine.ts packages/core/src/ai.ts packages/core/test/engine.test.ts packages/core/test/ai.test.ts
git commit -m "refactor(core): decouple discard from EndTurn; AI uses DiscardCards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- 功能 1（切换市场牌不清空选择）→ Task 2 ✓
- 功能 2 不补牌 → Task 1 `discardCards` 不抽牌 + 用例断言 `deck.length` 不变 ✓
- 功能 2 完全独立于结束回合 → Task 4 删除 `EndTurn.discardCardIds` 与 endTurn 弃牌循环 ✓
- 功能 2 每回合一次 → Task 1 `hasDiscarded` + 「rejects a second discard」用例 ✓
- 弃牌交互「先选后确认」→ Task 3 弃牌技能按钮 ✓
- AI 同步 → Task 4 Step 5 ✓
- 涉及文件表（spec）→ 全部被任务覆盖 ✓

**Placeholder scan:** ai.test.ts 用例的局面构造引用同文件既有 setup（非占位，是明确复用指令并给出断言代码）；其余步骤均含完整代码/命令。无 TBD/TODO。

**Type consistency:** `DiscardCards.cardIds`、`discarded.count`、`TurnState.hasDiscarded`、`endTurn(state, playerId, events)`、`discardCards(state, playerId, cardIds, events)` 在各任务间一致。`EndTurn` 在 Task 1-3 期间保持带可选 `discardCardIds`（不影响编译），Task 4 才移除——已在排序中保证每次提交可编译。
