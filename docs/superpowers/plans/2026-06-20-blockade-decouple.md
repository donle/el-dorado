# 边障碍「先移除、后移动」解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把边障碍的「移除」和「移动到对面」拆成两步独立动作，并接入链式多牌移动。

**Architecture:** 新增 core 动作 `RemoveBlockade`（占领障碍但不移动）。按「先加法、再迁移消费者、最后清理破坏性改动」排序，保证每次提交都编译且测试绿：先additively加 `RemoveBlockade`（不动 `stepTo`/`clearSpace`），再迁移 AI 与客户端改用它，最后才把 `stepTo`/`clearSpace` 的原子跨越移除并改现有测试。设计见 `docs/superpowers/specs/2026-06-20-blockade-decouple-design.md`。

**Tech Stack:** TypeScript 5.5 ESM, pnpm workspaces；core 用 Vitest；client 用 Vite + tsc。

## Global Constraints

- ESM：import 带 `.js` 后缀。规则违例 `throw new RuleError('中文提示')`。`applyAction` 已在入口校验回合归属（engine.ts:67-69）。
- 用户可见文案简体中文。引擎规则改动仅针对**边障碍**；碎石/基地**地格**清除（进入地格本身）不变。
- 移除决策（用户确认）：移除后**留在原地**；适用**符号障碍 + 碎石障碍**；符号障碍移除只扣 `blockade.cost`、activeMover 剩余力量保留；点被未占领障碍挡住的对面格 → 提示先移除。
- `RemoveBlockade` 占领障碍复用既有 `claimBlockade()`（已 emit `blockadeClaimed`，engine.ts:138）；不新增事件。
- 提交信息结尾：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 1: 核心 — 新增 `RemoveBlockade` 动作（additive，不动 stepTo/clearSpace）

纯加法：加动作 + 引擎处理 + dispatch + 测试。`stepTo`/`clearSpace` 暂不改（原子跨越仍可用），AI/客户端/现有测试保持通过。

**Files:**
- Modify: `packages/core/src/actions.ts`（Action 联合）
- Modify: `packages/core/src/engine.ts`（dispatch ~85-99；新增 `removeBlockade()`）
- Test: `packages/core/test/engine.test.ts`

**Interfaces:**
- Consumes: `player()`, `takeFromHand()`, `claimBlockade()`, `blockadeBetween()`, `blockadeMoveSymbol()`, `blockadeRequiresDiscard()`, `blockadeRequirementLabel()`, `RuleError`（均在 engine.ts）；`hexAt`。
- Produces: `type Action |= { type: 'RemoveBlockade'; blockadeId: string; cardIds?: string[] }`；engine 内部 `function removeBlockade(state, playerId, blockadeId, cardIds, events): void`。

- [ ] **Step 1: 写失败测试**（追加到 engine.test.ts 末尾）

```ts
describe('RemoveBlockade (decoupled)', () => {
  it('symbol blockade: deducts only blockade.cost, keeps remaining mover power, stays put, claims', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);
    const before = pos(s, 'p0');
    const r = run(
      s, 'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(before); // 留在原地
    const power = getDef(STRONG_CARD_BY_SYMBOL[symbol]).power;
    expect(r.state.turn!.activeMover).toEqual({ cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol, remaining: power - blockade.cost });
  });

  it('symbol blockade: errors when mover power < blockade.cost', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    // weak card: power 1 (explorer/sailor/traveller); blockade.cost is >= 2 for seams on classic
    const weak = BASIC_CARD_BY_SYMBOL[symbol];
    giveHand(s, 'p0', [weak]);
    const r = run(
      s, 'p0',
      { type: 'PlayMovementCard', cardId: `p0:${weak}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(false);
  });

  it('rubble blockade: discards exactly cost cards, stays put, claims, no draw', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades.find((b) => b.terrain === 'rubble')!;
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const edge = blockade.edges.find((e) => hexAt(e.a).terrain !== 'mountain' && hexAt(e.b).terrain !== 'mountain') ?? blockade.edges[0];
    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);
    const before = pos(s, 'p0');
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id, cardIds: ['p0:pioneer#t0'] });
    expect(r.result.ok).toBe(true);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(before); // 留在原地
    expect(r.state.players[0].discard.some((c) => c.id === 'p0:pioneer#t0')).toBe(true);
  });

  it('rubble blockade: errors when card count != cost', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades.find((b) => b.terrain === 'rubble')!;
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const edge = blockade.edges.find((e) => hexAt(e.a).terrain !== 'mountain' && hexAt(e.b).terrain !== 'mountain') ?? blockade.edges[0];
    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id, cardIds: ['p0:pioneer#t0', 'p0:explorer#t1'] });
    expect(r.result.ok).toBe(false);
  });

  it('errors on an already-claimed blockade', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    blockade.claimedBy = 'p1';
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id });
    expect(r.result.ok).toBe(false);
  });
});
```

> 注：`seamCrossing`、`STRONG_CARD_BY_SYMBOL`、`BASIC_CARD_BY_SYMBOL`、`blockadeSymbolForTest`、`pos`、`placeAt`、`giveHand`、`run`、`getDef` 均为该测试文件已有的辅助/导入。若 `getDef` 未导入，从 `'../src/cards.js'` 引入。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @eldorado/core test -- engine.test.ts`
Expected: FAIL（`RemoveBlockade` 不被 dispatch 识别 / 类型不存在）。

- [ ] **Step 3: 加动作类型** — `packages/core/src/actions.ts`，在 `BuyCard` 后、`UseAbility` 前加：

```ts
  | { type: 'BuyCard'; defId: string; paymentCardIds: string[] }
  | { type: 'RemoveBlockade'; blockadeId: string; cardIds?: string[] }
```
（若 `DiscardCards` 已在该位置，则加在其后，顺序不影响。）

- [ ] **Step 4: 加 dispatch 分支与 `removeBlockade()`** — `packages/core/src/engine.ts`

dispatch（在 `case 'BuyCard'` 之后）：
```ts
    case 'RemoveBlockade':
      return removeBlockade(state, playerId, action.blockadeId, action.cardIds ?? [], events);
```

在 `clearSpace` 之后新增（沿用既有 helper）：
```ts
function removeBlockade(
  state: GameState,
  playerId: string,
  blockadeId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const blockade = state.blockades.find((b) => b.id === blockadeId);
  if (!blockade) throw new RuleError('没有这个连接地形');
  if (blockade.claimedBy) throw new RuleError('这块连接地形已经打开');
  // The player must be standing beside one of this seam's covered edges.
  const beside = blockade.edges.some(
    (e) => sameAxial(e.a, p.position) || sameAxial(e.b, p.position),
  );
  if (!beside) throw new RuleError('当前棋子不在这块连接地形旁边');

  if (blockadeRequiresDiscard(blockade)) {
    if (cardIds.length !== blockade.cost) {
      throw new RuleError(`需要正好选择 ${blockade.cost} 张牌`);
    }
    for (const id of cardIds) p.discard.push(takeFromHand(p, id));
    claimBlockade(p, blockade, events);
    return; // 留在原地，不动 activeMover
  }

  const sym = blockadeMoveSymbol(blockade);
  const mover = state.turn!.activeMover;
  if (!mover || sym === null || mover.symbol !== sym || mover.remaining < blockade.cost) {
    throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能移除连接地形`);
  }
  mover.remaining -= blockade.cost; // 只扣障碍 cost，剩余力量保留
  claimBlockade(p, blockade, events);
  // 留在原地。
}
```

> `sameAxial` helper：若 engine.ts 没有，用现成的相等判断。检查 engine.ts 是否已有 `sameAxial`/`sameCoord`；client 用的是 `sameCoord`（来自 hex.js）。engine 里 `blockadeBetween` 用 `key()` 比较。**实现时**：若无 `sameAxial`，写内联 `(a, b) => a.q === b.q && a.r === b.r`，或复用 `key(e.a) === key(p.position)`（`key` 已在 engine.ts 导入）。优先 `key(...) === key(...)`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @eldorado/core test -- engine.test.ts`
Expected: PASS（新 5 例全过；其余不变）。

- [ ] **Step 6: 全核心测试 + 客户端编译**

Run: `pnpm --filter @eldorado/core test && pnpm --filter @eldorado/client build`
Expected: 全绿（atomic 跨越仍在，AI/客户端未受影响）；client tsc 通过。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/actions.ts packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): RemoveBlockade — claim edge blockade in place (additive)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: 核心 AI — 障碍计划改为「先移除再走」

`planTurn` 走路循环里，遇到未占领障碍时先 `RemoveBlockade`（占领但不动），其后对面格按正常地形 `StepTo`（此时障碍已占领，`stepTo` 仍能正常走——atomic 分支在 Task 4 才删，但对**已占领**障碍本就走正常 cost）。

**Files:**
- Modify: `packages/core/src/ai.ts`（planTurn 走路循环 ~204-255）
- Test: `packages/core/test/ai.test.ts`

**Interfaces:**
- Consumes: `RemoveBlockade`（Task 1）。
- Produces: 计划在跨越未占领障碍时输出 `RemoveBlockade` 在对应 `StepTo` 之前。

- [ ] **Step 1: 改 planTurn 走路循环**

把 ai.ts 走路循环（line 204-255）替换为下面逻辑（关键：先处理未占领障碍的移除，再走对面格；符号障碍移除用同一 mover 扣 `blockade.cost` 保留剩余）：

```ts
  let plannedPosition: Axial = { ...p.position };
  for (const hex of path) {
    const blockade = blockadeBetween(state, plannedPosition, hex);
    const isClear = hex.terrain === 'rubble' || hex.terrain === 'basecamp';

    // 1) Remove an unclaimed edge blockade first (stay put), then fall through to step.
    if (blockade && !blockade.claimedBy) {
      if (blockadeRequiresDiscard(blockade)) {
        const pick = available().slice().sort((a, b) => getDef(a.defId).power - getDef(b.defId).power).slice(0, blockade.cost);
        if (pick.length < blockade.cost) break;
        pick.forEach((c) => used.add(c.id));
        actions.push({ type: 'RemoveBlockade', blockadeId: blockade.id, cardIds: pick.map((c) => c.id) });
      } else {
        const seamSym = blockadeMoveSymbol(blockade)!;
        // Need one mover of seamSym with enough power for seam.cost + far terrain.
        const destDeduct = requiredFor(hex) === null ? 1 : enterCost(hex);
        const need = blockade.cost + destDeduct;
        if (mover && mover.symbol === seamSym && mover.remaining >= need) {
          actions.push({ type: 'RemoveBlockade', blockadeId: blockade.id });
          mover.remaining -= blockade.cost;
        } else {
          const cand = available()
            .map((c) => ({ c, sym: declareSymbol(c.defId, seamSym), pow: getDef(c.defId).power }))
            .filter((x) => x.sym !== null && x.pow >= need)
            .sort((a, b) => a.pow - b.pow)[0];
          if (!cand) break;
          used.add(cand.c.id);
          actions.push({ type: 'PlayMovementCard', cardId: cand.c.id, symbol: cand.sym! });
          actions.push({ type: 'RemoveBlockade', blockadeId: blockade.id });
          mover = { symbol: cand.sym!, remaining: cand.pow - blockade.cost };
        }
      }
      moved = true;
      // blockade now open in-plan: fall through to step onto `hex` by terrain.
    }

    // 2) Clear a rubble/basecamp DESTINATION HEX (unchanged: enter+clear).
    if (isClear) {
      const cost = hex.cost;
      const pick = available().slice().sort((a, b) => getDef(a.defId).power - getDef(b.defId).power).slice(0, cost);
      if (pick.length < cost) break;
      pick.forEach((c) => used.add(c.id));
      actions.push({ type: 'ClearSpace', to: { q: hex.q, r: hex.r }, cardIds: pick.map((c) => c.id) });
      mover = null;
      moved = true;
      plannedPosition = { q: hex.q, r: hex.r };
      continue;
    }

    // 3) Normal step onto `hex` by its terrain (blockade, if any, now open).
    const required = requiredFor(hex);
    const deduct = required === null ? 1 : enterCost(hex);
    if (mover && mover.remaining >= deduct && (required === null || required === mover.symbol)) {
      actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
      mover.remaining -= deduct;
      moved = true;
      plannedPosition = { q: hex.q, r: hex.r };
      continue;
    }
    const candidates = available()
      .map((c) => ({ c, sym: declareSymbol(c.defId, required), pow: getDef(c.defId).power }))
      .filter((x) => x.sym !== null && x.pow >= deduct)
      .sort((a, b) => a.pow - b.pow);
    if (candidates.length === 0) break;
    const chosen = candidates[0];
    used.add(chosen.c.id);
    actions.push({ type: 'PlayMovementCard', cardId: chosen.c.id, symbol: chosen.sym! });
    actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
    mover = { symbol: chosen.sym!, remaining: chosen.pow - deduct };
    moved = true;
    plannedPosition = { q: hex.q, r: hex.r };
  }
```

> `edgeCanTraverse`（line 189-201）和 buy-gap（line 265+）的可行性/需求估算**保持不变**——它们已按 `blockade.cost + 对面地形` 估算总需求，与「同一符号 mover 移除+走对面」一致。

- [ ] **Step 2: 运行 AI 测试**

Run: `pnpm --filter @eldorado/core test -- ai.test.ts`
Expected: 现有用例（含「plays a full 2-AI game to a winner (multiple seeds)」「rests」「DiscardCards before EndTurn」）全 PASS。若某局面跨越障碍，计划现在含 `RemoveBlockade`，全程仍能走完。

- [ ] **Step 3: 加一条断言（障碍计划含 RemoveBlockade 在 StepTo 前）**

在 ai.test.ts 找一个会跨越未占领障碍的局面（可复用全局游戏用例的 seed，或构造 `placeAt` 到符号 seam 的 from 并给足力量的牌），断言：
```ts
const ri = plan.findIndex((x) => x.type === 'RemoveBlockade');
const si = plan.findIndex((x, i) => x.type === 'StepTo' && i > ri);
expect(ri).toBeGreaterThanOrEqual(0);
expect(si).toBeGreaterThan(ri);
```
> 若难以稳定构造跨障碍局面，则跳过此新增断言，仅保留 Step 2 的全量回归（在报告中说明）。不得写恒真断言。

- [ ] **Step 4: 全核心测试 + 客户端编译**

Run: `pnpm --filter @eldorado/core test && pnpm --filter @eldorado/client build`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/ai.ts packages/core/test/ai.test.ts
git commit -m "refactor(core): AI removes edge blockade then steps (decoupled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: 客户端 — 点障碍移除、点被挡格提示、链式接入

**Files:**
- Modify: `packages/client/src/main.ts`（`tryActOnBlockade`、`tryActOnHex`、`onCardClick` 的 clear 态、`startBlockadeClear`、`recomputeHighlights`）

**Interfaces:**
- Consumes: `RemoveBlockade`（Task 1）；既有 `pickHandMover`、`blockadeMoveSymbol`、`blockadeRequiresDiscard`、`blockadeDestination`、`movementRequirement`、`canUseBlockade`、`canEnter`、`getDef`、`cardDefId`、`this.selected`。
- Produces: 无新接口；交互变更。

- [ ] **Step 1: `tryActOnBlockade` — 未占领障碍 → 移除（留原地）**

把 `tryActOnBlockade`（点击连接地形）改为：已占领障碍走正常跨越（对面格 StepTo）；未占领障碍按类型移除。替换其主体：

```ts
  private tryActOnBlockade(id: string): boolean {
    if (!this.isMyTurn()) return false;
    if (this.mode === 'clear') return false;
    const blockade = this.blockadeById(id);
    if (!blockade) return false;

    // Unclaimed: REMOVE in place (do not move).
    if (!blockade.claimedBy) {
      if (blockadeRequiresDiscard(blockade)) {
        // enter card-selection to discard exactly blockade.cost cards
        this.mode = 'clear';
        this.clearBlockadeId = blockade.id;
        this.clearTarget = null; // marker: removing a blockade, not a hex
        this.selected.clear();
        this.hint = `选 ${blockade.cost} 张牌弃掉，移除这块连接地形`;
        this.renderHud();
        this.recomputeHighlights();
        return true;
      }
      const seamSym = blockadeMoveSymbol(blockade);
      const mover = this.state!.turn?.activeMover;
      if (seamSym && mover && mover.symbol === seamSym && mover.remaining >= blockade.cost) {
        this.act({ type: 'RemoveBlockade', blockadeId: blockade.id });
        return true;
      }
      const hand = this.me?.hand ?? [];
      const candidates = [...this.selected]
        .filter((cid) => hand.some((h) => h.id === cid))
        .map((cid) => ({ id: cid, defId: cardDefId(cid, this.state!) }));
      const pick = pickHandMover(seamSym, blockade.cost, candidates);
      if (pick) {
        this.selected.delete(pick.cardId);
        this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
        this.act({ type: 'RemoveBlockade', blockadeId: blockade.id });
        return true;
      }
      this.flash('没有可用于移除这块连接地形的牌');
      return true;
    }

    // Claimed: cross normally onto the far hex.
    const mover = this.state!.turn?.activeMover;
    if (mover && mover.remaining > 0) {
      const dest = this.blockadeDestination(blockade, mover.symbol, mover.remaining);
      if (dest) { this.act({ type: 'StepTo', to: { q: dest.q, r: dest.r } }); return true; }
    }
    const destGeo = this.blockadeDestination(blockade);
    if (!destGeo) return false;
    const req = this.movementRequirement(destGeo);
    const hand = this.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((cid) => hand.some((h) => h.id === cid))
      .map((cid) => ({ id: cid, defId: cardDefId(cid, this.state!) }));
    const pick = pickHandMover(req.required, req.cost, candidates);
    if (pick) {
      const dest = this.blockadeDestination(blockade, pick.symbol, getDef(pick.defId).power);
      if (!dest) return false;
      this.selected.delete(pick.cardId);
      this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
      this.act({ type: 'StepTo', to: { q: dest.q, r: dest.r } });
      return true;
    }
    return false;
  }
```

> 说明：未占领时分两类。符号障碍优先续用 activeMover 直接 `RemoveBlockade`；否则用 `pickHandMover(seamSym, blockade.cost, …)` 先打牌再移除。碎石障碍进入选牌态（mode='clear'，`clearBlockadeId` 设、`clearTarget=null`），由 `onCardClick` 选满后提交。

- [ ] **Step 2: `onCardClick` 的 clear 态 — 区分「移除障碍」与「清地格」**

`onCardClick` 里 `mode==='clear'` 分支：选满 cost 时，若 `clearBlockadeId` 存在则发 `RemoveBlockade`，否则（地格清除）仍发 `ClearSpace`：

```ts
    if (this.mode === 'clear') {
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else this.selected.add(cardId);
      const cost = this.clearBlockadeId
        ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
        : this.hexAt(this.clearTarget!)?.cost ?? 0;
      if (this.selected.size === cost) {
        if (this.clearBlockadeId) {
          this.act({ type: 'RemoveBlockade', blockadeId: this.clearBlockadeId, cardIds: [...this.selected] });
        } else if (this.clearTarget) {
          this.act({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.selected] });
        }
        return;
      }
      this.renderHud();
      return;
    }
```
> 注意：现版本 `clear` 态依赖 `this.clearTarget`。本改动让 `clearTarget` 可为 null（移除障碍时），用 `clearBlockadeId` 区分。确保引用 `clearTarget` 处都加判空（如上 `this.hexAt(this.clearTarget!)` 仅在 `!clearBlockadeId` 分支走到）。

- [ ] **Step 3: `tryActOnHex` — 被未占领障碍挡住 → 提示先移除**

`tryActOnHex` 里，在计算 mover/pick 之前，加：
```ts
    const between = this.blockadeBetween(me.position, hex);
    if (between && !between.claimedBy) {
      this.flash('先点连接地形移除障碍');
      return true;
    }
```
> 放在「可清除地格」判断之后、移动逻辑之前。`flash` 已存在。

- [ ] **Step 4: `startBlockadeClear` 兼容**

`startBlockadeClear`（若仍被 `tryActOnHex` 的碎石**地格**路径调用）保持原样，但其内部把 `this.payment.clear()`/`selectedCardId` 早已在统一多选改造中换成 `this.selected.clear()`。确认它设置 `clearTarget`（地格）而非 `clearBlockadeId`，以便走 `ClearSpace`。若 `startBlockadeClear` 当前用于 blockade（边障碍）入口，则改为不再由 hex 路径触发——边障碍移除统一走 `tryActOnBlockade`（Step 1）。核对并保证：hex 路径只处理碎石/基地**地格**清除。

- [ ] **Step 5: `recomputeHighlights` — 未占领障碍可移除即高亮**

确认未占领障碍的高亮判定：符号障碍按「选中牌或 activeMover 能付 `blockade.cost`」、碎石障碍按「手牌数 ≥ blockade.cost」。沿用既有 `canUseBlockade`/`canClearBlockade` 思路，但 `canUseBlockade` 现按「能走到对面」判定（含对面地形 cost）。改为新的「能否移除」判定（只看 `blockade.cost`）：
```ts
  private canRemoveBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade)
      && blockadeMoveSymbol(blockade) === symbol && power >= blockade.cost;
  }
```
在 `recomputeHighlights` 的选中/mover 分支里，对未占领符号障碍用 `canRemoveBlockade(...)` 判定高亮；碎石障碍用既有 `canClearBlockade`（手牌足够）。

- [ ] **Step 6: 编译**

Run: `pnpm --filter @eldorado/client build`
Expected: tsc + vite 通过。

- [ ] **Step 7: 提交**

```bash
git add packages/client/src/main.ts
git commit -m "feat(client): remove edge blockade in place, then step across

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 核心清理 — `stepTo`/`clearSpace` 去原子跨越，改现有测试

AI 与客户端已改用 `RemoveBlockade`，现在把 `stepTo` 的未占领-seam 原子跨越移除、`clearSpace` 的 blockade 支移除，并把现有 seam/rubble 测试改成两步。

**Files:**
- Modify: `packages/core/src/engine.ts`（`stepTo` ~249-277；`clearSpace` ~290-307）
- Test: `packages/core/test/engine.test.ts`（现有 seam/rubble 用例）

- [ ] **Step 1: 改测试为两步（先失败）**

改 `'claims an unclaimed seam blockade for the first player who crosses it'`（~243）：把 `run(..., PlayMovementCard, StepTo)` 改为三段——`PlayMovementCard` → `RemoveBlockade{blockadeId: blockade.id}` → `StepTo{to: crossing.to}`，断言 claim 在 RemoveBlockade 后、最终位置为 `crossing.to`：
```ts
    const { state, result } = run(
      s, 'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
      { type: 'StepTo', to: crossing.to },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(state.blockades[0].claimedBy).toBe('p0');
    expect(pos(state, 'p0')).toEqual(crossing.to);
    expect(result.events).toContainEqual({ type: 'blockadeClaimed', playerId: 'p0', blockadeId: blockade.id });
```
同样改 `'claims the same blockade when crossing any covered seam edge'`（~273）：在其 `PlayMovementCard`+`StepTo` 之间插入 `RemoveBlockade{blockadeId: blockade.id}`。

改 `'requires discarding cards to claim a rubble blockade'`（~342）：
- 第一段（期望失败）改为：直接 `StepTo` 跨未占领 seam → 期望 `ok===false`，错误匹配 `/先移除连接地形/`（新文案）。
- 第二段改为：`RemoveBlockade{blockadeId: blockade.id, cardIds: ['p0:pioneer#t0']}` → 期望 ok、`claimedBy==='p0'`、`pos` 仍为 `edge.a`（留原地），再 `StepTo{to: edge.b}` → 期望 ok、`pos===edge.b`。
- 若有 `'blockade crossing charges blockade + destination terrain'` 之类断言组合 cost 的用例（来自 commit ac1dc10），改为两步并相应断言 mover 剩余力量（移除扣 `blockade.cost`，走对面扣对面地形 cost）。

> 用 `grep -n "StepTo" packages/core/test/engine.test.ts` 找出所有跨未占领 seam 的 `StepTo`，逐一插入 `RemoveBlockade`。

Run: `pnpm --filter @eldorado/core test -- engine.test.ts`
Expected: 改后的用例先 FAIL（因为 stepTo 仍原子跨越，RemoveBlockade 后再 StepTo 会重复扣/位置不符；或新错误文案未实现）。

- [ ] **Step 2: 改 `stepTo`** — 删除未占领-blockade 原子分支，改为报错。

把 engine.ts `stepTo` 中处理 `blockade && !blockade.claimedBy` 的整段（计算 `blockSym`、组合 `deduct = blockade.cost + destDeduct`、`required = blockSym` 等）替换为：
```ts
  const blockade = blockadeBetween(state, p.position, hex);
  if (blockade && !blockade.claimedBy) {
    throw new RuleError('需要先移除连接地形障碍');
  }
  const required = destRequired;
  let deduct = destDeduct;
```
（保留其后的 `required !== null && required !== mover.symbol` 检查、`mover.remaining < deduct` 检查、`mover.remaining -= deduct`、`claimBlockade(p, blockade, events)`（对已占领是 no-op）、`moveTo`。）

- [ ] **Step 3: 改 `clearSpace`** — 删除 blockade 支，仅留地格清除。

把 `clearSpace` 开头的 `const blockade = blockadeBetween(...)` 与 `if (blockade && !blockade.claimedBy) { ... }` 整段删除；保留从 `if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp')` 起的地格清除逻辑。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @eldorado/core test`
Expected: 全 PASS（改后的 seam/rubble 两步用例 + Task 1 的 RemoveBlockade 用例 + 其余）。

- [ ] **Step 5: 全量 + 客户端编译 + 无残留 atomic 引用**

Run: `pnpm --filter @eldorado/core test && pnpm --filter @eldorado/client build`
Expected: core 全绿；client 通过。

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "refactor(core): stepTo/clearSpace require RemoveBlockade first; update tests

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- `RemoveBlockade` 动作（符号/碎石，留原地，符号只扣 cost 保留剩余）→ Task 1 ✓
- `stepTo` 未占领 seam 报错、已占领正常 → Task 4 ✓
- `clearSpace` 只留地格清除 → Task 4 ✓
- AI 先移除再走 → Task 2 ✓
- 客户端点障碍移除 / 点被挡格提示 / 链式接入 / 高亮 → Task 3 ✓
- 复用 `blockadeClaimed` 事件 → Task 1（claimBlockade）✓
- 范围：不解耦地格清除 → Task 4 保留地格支 ✓

**Placeholder scan:** Task 2/3 因涉及大函数重写，给出完整目标代码块 + 定位指引；Task 3 Step 4/5 含「核对」类指令但都给了判定函数与具体改法。无 TBD。AI 测试新增断言带「难以构造则跳过并说明」的明确回退（非恒真）。

**Type consistency:** `RemoveBlockade{blockadeId, cardIds?}` 在 Task 1 定义、Task 2/3 调用一致；`removeBlockade(state, playerId, blockadeId, cardIds, events)`；`pickHandMover(req, cost, candidates)` 与既有一致；`canRemoveBlockade(blockade, symbol, power)` 新增于 Task 3。每次提交编译保证：Task 1 additive、Task 2/3 迁移消费者、Task 4 才删原子跨越。
