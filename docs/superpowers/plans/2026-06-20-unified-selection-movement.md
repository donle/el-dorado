# 统一手牌多选 + 多牌连走 Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把手牌交互改成统一多选——选好牌后点市场牌购买、点相邻格多牌连走、点弃牌键弃掉选中；多牌移动用「最省优先」逐格自动挑牌。

**Architecture:** 新增 core 纯函数 `pickHandMover`（最省挑牌，单测覆盖）。客户端 `main.ts` 用单一 `selected: Set<string>` 替换 `selectedCardId`/`payment`/`discardSet`，移除 buy/discard 的 `mode`，移动逐格调用 `pickHandMover` 编排既有 `PlayMovementCard`/`StepTo`/`activeMover`。**引擎不改。** 设计见 `docs/superpowers/specs/2026-06-20-selection-discard-ux-design.md` 的「修订 v2」节。

**Tech Stack:** TypeScript 5.5 ESM, pnpm workspaces；core 用 Vitest；client 用 Vite + tsc。

## Global Constraints

- ESM：import 带 `.js` 后缀。core 公共 API 经 `packages/core/src/index.ts` 用 `export * from './x.js'` 导出。
- 纯函数无副作用、不依赖 DOM/状态全局；用户可见文案简体中文。
- 引擎/规则不改；本计划是 core 加一个纯 helper + 客户端交互重写。
- 最省挑牌优先级（用户确认）：**续用当前 activeMover（零浪费，调用方先试）> 单符号牌 > 同类中溢出最小（`power − deduct` 最小）**。
- 走不动的终止态：没有牌能付当前步时停下、提示，不强行出牌。
- v1 已提交并保留：core `DiscardCards` 动作、脱离 `EndTurn`、AI 迁移——本计划不动这些。
- 提交信息结尾：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 5: 核心 — `pickHandMover` 最省挑牌纯函数（TDD）

**Files:**
- Create: `packages/core/src/movement.ts`
- Modify: `packages/core/src/index.ts`（加 `export * from './movement.js';`）
- Test: `packages/core/test/movement.test.ts`（新）

**Interfaces:**
- Consumes: `movableSymbols(defId)`, `getDef(defId).power`（来自 `./cards.js`）；`MoveSymbol`（来自 `./types.js`）。
- Produces:
  ```ts
  export function pickHandMover(
    req: MoveSymbol | null,
    deduct: number,
    candidates: { id: string; defId: string }[],
  ): { cardId: string; symbol: MoveSymbol } | null
  ```

挑选规则：
1. 候选过滤：`movableSymbols(defId)` 含 `req`（`req===null` 时只要 `movableSymbols` 非空即可），且 `getDef(defId).power >= deduct`。
2. 排序：先 `movableSymbols(defId).length` 升序（单符号优先），再 `getDef(defId).power` 升序（溢出最小）；同分保持输入顺序（稳定）。取第一。
3. 选中卡的 `symbol`：`req !== null` → `req`；`req === null` → `movableSymbols(defId)[0]`。
4. 无候选 → `null`。

- [ ] **Step 1: 写失败测试** — `packages/core/test/movement.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { pickHandMover } from '../src/movement.js';

// 真实卡定义参考：explorer=machete/power1, scout=machete/power2, pioneer=machete/power5,
// sailor=paddle/power1, jack=joker/power1(三符号), adventurer=joker/power2(三符号).
describe('pickHandMover', () => {
  it('returns null when no candidate matches the symbol', () => {
    const r = pickHandMover('paddle', 1, [{ id: 'a', defId: 'explorer' }]); // explorer=machete
    expect(r).toBeNull();
  });

  it('returns null when no candidate has enough power', () => {
    const r = pickHandMover('machete', 3, [{ id: 'a', defId: 'scout' }]); // power 2 < 3
    expect(r).toBeNull();
  });

  it('prefers the smallest sufficient power (least overflow)', () => {
    const r = pickHandMover('machete', 2, [
      { id: 'big', defId: 'pioneer' }, // power 5
      { id: 'fit', defId: 'scout' }, // power 2
    ]);
    expect(r).toEqual({ cardId: 'fit', symbol: 'machete' });
  });

  it('prefers single-symbol cards over jokers even if overflow is larger', () => {
    // scout: machete only, power 2 (overflow 1). jack: joker(3 symbols), power 1 (overflow 0).
    // Single-symbol wins despite jack having smaller overflow.
    const r = pickHandMover('machete', 1, [
      { id: 'joker', defId: 'jack' },
      { id: 'single', defId: 'scout' },
    ]);
    expect(r).toEqual({ cardId: 'single', symbol: 'machete' });
  });

  it('falls back to a joker when no single-symbol card fits', () => {
    const r = pickHandMover('paddle', 1, [{ id: 'j', defId: 'jack' }]); // joker covers paddle
    expect(r).toEqual({ cardId: 'j', symbol: 'paddle' });
  });

  it('wildcard req (null) accepts any non-empty mover, smallest power first', () => {
    const r = pickHandMover(null, 1, [
      { id: 'big', defId: 'pioneer' }, // machete power 5
      { id: 'small', defId: 'sailor' }, // paddle power 1
    ]);
    expect(r).toEqual({ cardId: 'small', symbol: 'paddle' });
  });

  it('ignores non-mover cards (action cards have no movable symbols)', () => {
    const r = pickHandMover(null, 1, [{ id: 'c', defId: 'cartographer' }]); // action, power 0, no symbols
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @eldorado/core test -- movement.test.ts`
Expected: FAIL（`pickHandMover` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现 `pickHandMover`** — `packages/core/src/movement.ts`

```ts
import type { MoveSymbol } from './types.js';
import { getDef, movableSymbols } from './cards.js';

/**
 * Among candidate hand cards, pick the least-wasteful one that can pay a single
 * movement step (symbol `req`, cost `deduct`). Caller should first try to reuse
 * the active mover (zero waste); call this only when a fresh card is needed.
 *
 * Order: single-symbol cards before jokers, then smallest sufficient power
 * (minimal overflow). Returns null when nothing can pay the step.
 */
export function pickHandMover(
  req: MoveSymbol | null,
  deduct: number,
  candidates: { id: string; defId: string }[],
): { cardId: string; symbol: MoveSymbol } | null {
  const usable = candidates.filter((c) => {
    const syms = movableSymbols(c.defId);
    if (syms.length === 0) return false;
    if (req !== null && !syms.includes(req)) return false;
    return getDef(c.defId).power >= deduct;
  });
  if (usable.length === 0) return null;
  usable.sort((a, b) => {
    const la = movableSymbols(a.defId).length;
    const lb = movableSymbols(b.defId).length;
    if (la !== lb) return la - lb; // single-symbol first
    return getDef(a.defId).power - getDef(b.defId).power; // least overflow
  });
  const chosen = usable[0];
  const symbol = req !== null ? req : movableSymbols(chosen.defId)[0];
  return { cardId: chosen.id, symbol };
}
```

- [ ] **Step 4: 导出** — `packages/core/src/index.ts` 加一行（紧跟其他 `export * from`）：

```ts
export * from './movement.js';
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @eldorado/core test -- movement.test.ts`
Expected: PASS（7 用例全过）。

- [ ] **Step 6: 全核心测试 + 客户端编译自检**

Run: `pnpm --filter @eldorado/core test && pnpm --filter @eldorado/client build`
Expected: core 全绿；client 仍可编译（尚未用到新函数）。

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/movement.ts packages/core/src/index.ts packages/core/test/movement.test.ts
git commit -m "feat(core): pickHandMover — least-waste card pick for multi-card movement

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 客户端 — 统一手牌多选 + 多牌连走重写

把 `main.ts` 的选牌/购买/弃牌/移动/高亮整体改成统一 `selected` 多选模型，移动逐格调用 `pickHandMover`。这是一次贯穿多个方法的重写；无客户端自动化测试，验证靠 `tsc` 编译 + 控制器手动跑应用。

**Files:**
- Modify: `packages/client/src/main.ts`

**Interfaces:**
- Consumes: `pickHandMover`（Task 5），既有 `getDef`/`movableSymbols`/`coinValue`/`cardDefId`/`canEnter`/`movementRequirement`/`blockadeDestination`/`blockadeMoveSymbol`。
- Produces: 无新导出；交互行为变更。

> 实现者注意：先通读 `main.ts` 涉及方法（行号会随编辑漂移，按方法名定位）。`s` 是 `renderHud` 内的 `GameState` 局部。`this.act(...)` 发动作；服务器回包后 `main.ts` 约 163 行处会 `resetSelection()`。

- [ ] **Step 1: 替换选择状态字段**

类字段处（原 `selectedCardId: string | null = null;`、`payment = new Set<string>();`、`discardSet = new Set<string>();`）：
- 删除这三个字段。
- 新增：`selected = new Set<string>();`
- `mode` 类型收窄为 `'idle' | 'clear'`（删除 `'buy'`/`'discard'` 取值）。若 `Mode` 是单独类型别名，改成 `type Mode = 'idle' | 'clear';`。

`pickHandMover` 要在文件顶部从 `@eldorado/core` 的 import 块里引入。

- [ ] **Step 2: `resetSelection`**

```ts
private resetSelection(): void {
  this.selected.clear();
  this.mode = 'idle';
  this.buyTargetDefId = null;
  this.clearTarget = null;
  this.clearBlockadeId = null;
  // 保留原方法里其它非选择类重置（如 hint 清理、pinned 预览等），逐项核对后保留。
}
```
> 核对原 `resetSelection` 里还重置了哪些字段（如 `hint`），原样保留那些，仅把选择相关三件套换成 `selected`/`buyTargetDefId`/`clear*`。

- [ ] **Step 3: `onCardClick` — 统一多选 / 清除态计数**

```ts
private onCardClick(cardId: string): void {
  if (!this.isMyTurn()) return;
  if (this.mode === 'clear' && this.clearTarget) {
    if (this.selected.has(cardId)) this.selected.delete(cardId);
    else this.selected.add(cardId);
    const cost = this.clearBlockadeId
      ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
      : this.hexAt(this.clearTarget)?.cost ?? 0;
    if (this.selected.size === cost) {
      this.act({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.selected] });
      return;
    }
    this.renderHud();
    return;
  }
  if (this.selected.has(cardId)) this.selected.delete(cardId);
  else this.selected.add(cardId);
  this.recomputeHighlights();
  this.renderHud();
}
```

- [ ] **Step 4: `onMarketClick` — 仅切换目标，保留选择**

```ts
private onMarketClick(defId: string): void {
  if (!this.isMyTurn()) return;
  if (this.state!.turn?.hasBought) { this.flash('本回合已购买 · 每回合限买 1 张'); return; }
  this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
  this.hint = this.buyTargetDefId ? '选手牌支付，然后点「确认购买」' : '';
  if (this.buyTargetDefId) this.mobilePanel = null;
  this.renderHud();
}
```

- [ ] **Step 5: `confirmBuy` — 用 `selected` 付款**

```ts
private confirmBuy(): void {
  if (!this.buyTargetDefId) return;
  this.act({ type: 'BuyCard', defId: this.buyTargetDefId, paymentCardIds: [...this.selected] });
}
```

- [ ] **Step 6: `startBlockadeClear` — 清空改为 `selected`**

把方法里的 `this.selectedCardId = null;` 与 `this.payment.clear();` 替换为 `this.selected.clear();`（其余不变，仍 `this.mode = 'clear'`）。

- [ ] **Step 7: `tryActOnHex` — 多牌连走（逐格，最省挑牌）**

- guard 改为：`if (this.mode === 'clear') return false;`（删去 `buy`/`discard`）。
- 「可清除地形」分支：把 `this.selectedCardId = null; this.payment.clear();` 换成 `this.selected.clear();`，其余保留（设 `mode='clear'`、`clearTarget` 等）。
- 把原「2) 续用 activeMover」「3) 打出 selectedCardId」两段替换为：

```ts
    const mover = this.state!.turn?.activeMover;
    // 2) 续用当前移动牌（零浪费）。
    if (mover && this.canEnter(hex, mover.symbol, mover.remaining)) {
      this.act({ type: 'StepTo', to: c });
      return true;
    }
    // 3) 从选中且仍在手的牌里最省挑一张。
    const { required, cost } = this.movementRequirement(hex);
    const hand = this.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((id) => hand.some((h) => h.id === id))
      .map((id) => ({ id, defId: cardDefId(id, this.state!) }));
    const pick = pickHandMover(required, cost, candidates);
    if (pick && this.canEnter(hex, pick.symbol, getDef(pick.defId).power)) {
      this.selected.delete(pick.cardId);
      this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
      this.act({ type: 'StepTo', to: c });
      return true;
    }
    return false;
```

- [ ] **Step 8: `tryActOnBlockade` — 同样改为多牌最省**

- guard 改为：`if (this.mode === 'clear') return false;`。
- 续用 activeMover 分支不变。
- 把原 `if (this.selectedCardId) { ... }` 段替换为：

```ts
    const destGeo = this.blockadeDestination(blockade);
    if (!destGeo) return false;
    const req = this.movementRequirement(destGeo);
    const hand = this.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((id) => hand.some((h) => h.id === id))
      .map((id) => ({ id, defId: cardDefId(id, this.state!) }));
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
```

- [ ] **Step 9: `recomputeHighlights` — 按选中集合高亮**

把 `if (this.mode === 'clear' || this.mode === 'buy' || this.mode === 'discard')` 改为 `if (this.mode === 'clear')`；把 `else if (this.selectedCardId)` 段替换为按 `this.selected` 并集：

```ts
    } else if (this.selected.size > 0) {
      for (const id of this.selected) {
        const def = getDef(cardDefId(id, this.state!));
        const syms = movableSymbols(def.defId);
        for (const h of adj) {
          if (syms.some((s) => this.canEnter(h, s, def.power))) out.push(h);
        }
        for (const blockade of unclaimedBlockades) {
          if (syms.some((s) => this.canUseBlockade(blockade, s, def.power))) blockadeOut.add(blockade.id);
        }
      }
      for (const blockade of unclaimedBlockades) {
        if (this.canClearBlockade(blockade)) blockadeOut.add(blockade.id);
      }
    } else {
```
（`out` 可能重复无妨；`blockadeOut` 是 Set。`mover` 分支保持不变。）

- [ ] **Step 10: 动作条（`renderHud`）— 统一按钮**

把 buy/clear/discard/else 的整段动作条逻辑替换为（在 `myTurn && s.phase === 'playing'` 内）：

```ts
      if (this.mode === 'clear') {
        bar.appendChild(button('取消', () => this.cancelMode(), true));
      } else {
        if (this.buyTargetDefId) {
          const cost = getDef(this.buyTargetDefId).cost;
          const have = [...this.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
          const buy = button(`确认购买 (${have}/${cost}💰)`, () => this.confirmBuy(), false);
          buy.className = 'gold';
          buy.disabled = have < cost;
          bar.appendChild(buy);
        }
        bar.appendChild(button('结束回合', () => this.act({ type: 'EndTurn' }), true));
        const discarded = !!s.turn?.hasDiscarded;
        const skill = button(discarded ? '已弃牌' : '弃牌', () => {
          if (discarded || this.selected.size === 0) return;
          this.act({ type: 'DiscardCards', cardIds: [...this.selected] });
        }, true);
        skill.disabled = discarded || this.selected.size === 0;
        bar.appendChild(skill);
      }
```
> 弃牌键现在直接弃掉选中的牌（每回合一次，`hasDiscarded` 后置灰）；无独立弃牌模式。`cancelMode()` 保持调用 `resetSelection()+renderHud()`（已存在）。

- [ ] **Step 11: 清理 `mode` 残留**

全文件搜索 `this.mode === 'buy'`、`this.mode === 'discard'`、`payment`、`discardSet`、`selectedCardId`，逐处改为新模型或删除：
- `refreshPinnedPreview` 等用 `selectedCardId` 处：改为「若 `selected.size===1` 用那张做预览，否则不固定预览」或直接去掉单卡预览逻辑（择简，行为不回归即可）。
- 卡片渲染的 `selected`/`payment`/`discarding` CSS class：统一成「在 `this.selected` 里则加高亮 class」（沿用现有某个高亮 class，如 `selected`）。
- `hasSelection()`（约 654 行 `return !!this.selectedCardId || !!this.buyTargetDefId;`）：改为 `return this.selected.size > 0 || !!this.buyTargetDefId;`。

Run（自检搜索应无残留）：
```bash
grep -n "selectedCardId\|this\.payment\|discardSet\|mode === 'buy'\|mode === 'discard'" packages/client/src/main.ts
```
Expected: 无输出。

- [ ] **Step 12: 编译**

Run: `pnpm --filter @eldorado/client build`
Expected: tsc + vite 通过、无类型错误。

- [ ] **Step 13: 提交**

```bash
git add packages/client/src/main.ts
git commit -m "feat(client): unified hand multi-select + multi-card movement

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage（对照 spec 修订 v2）：**
- 统一 `selected` 替换三件套 → Task 6 Step 1/11 ✓
- 点市场牌购买保留选择 + 确认按钮 → Step 4/5/10 ✓
- 弃牌键弃掉选中（每回合一次）→ Step 10 ✓
- 多牌连走 + 最省挑牌（续用>单符号>溢出最小）→ Task 5 + Step 7/8 ✓
- 走不动终止态（pickHandMover 返回 null → 不出牌）→ Task 5 + Step 7/8 ✓
- 高亮按选中集合 → Step 9 ✓
- 引擎不改 ✓（无 core engine/actions/types 改动）

**Placeholder scan:** Task 6 因是大文件重写，部分步骤给「目标代码 + 定位指引」而非逐字替换串（文件大、行号会漂移）；每步均含完整目标实现，无 TBD。

**Type consistency:** `pickHandMover(req: MoveSymbol|null, deduct, candidates: {id,defId}[]) => {cardId,symbol}|null` 在 Task 5 定义、Task 6 Step 7/8 调用一致；`movementRequirement` 返回的 `{required, cost}` 对应 `pickHandMover(required, cost, …)`。`selected: Set<string>` 全程一致。
