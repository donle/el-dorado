/**
 * ai/planner — turns a GameState + playerId into an ordered Action[] the
 * server can apply through the same validated reducer humans use.
 *
 * Heuristic:
 *   1. Pathfind to El Dorado minimising total terrain cost (Dijkstra).
 *   2. Walk that path with the cheapest sufficient cards.
 *   3. If a hex blocks it, buy the cheapest market card that would let it
 *      enter (matching symbol / joker, power ≥ cost); otherwise build
 *      economy by buying the most valuable affordable card.
 */
import type { Axial, GameState, Hex, MoveSymbol } from '../types.js';
import type { Action } from '../actions.js';
import { coinValue, getDef, HAND_SIZE, movableSymbols } from '../cards.js';
import { blockadeMoveSymbol, blockadeRequiresDiscard, requiredFor } from '../terrain.js';
import {
  blockadeBetween,
  canTraverse,
  canUseNativeBetween,
  capability,
  declareSymbol,
  enterCost,
  isNativeCard,
  stepPathCost,
  type Need,
} from './helpers.js';
import { pathToFinish } from './pathfinding.js';
import { chooseMarketPromotion, matchesNeed } from './market.js';

export function planTurn(state: GameState, playerId: string): Action[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return [{ type: 'EndTurn' }];
  if (state.turn?.playerId === playerId && state.turn.pendingRemoval) {
    return [{ type: 'RemoveCards', cardIds: [] }, { type: 'EndTurn' }];
  }

  const actions: Action[] = [];
  const used = new Set<string>();
  const available = () => p.hand.filter((c) => !used.has(c.id));
  let mover: { symbol: MoveSymbol; remaining: number } | null = null;
  let moved = false;

  const cap = capability(p);
  const owned = p.deck.length + p.hand.length + p.discard.length;
  const nativeOwned = [...p.deck, ...p.hand, ...p.discard].some((c) => isNativeCard(c.defId));
  const openedBlockades = new Set<string>();
  let plannedPosition: Axial = { ...p.position };
  const tryUseNative = (hex: Hex): boolean => {
    const native = available().find((c) => isNativeCard(c.defId));
    if (!native || !canUseNativeBetween(state, p, plannedPosition, hex, openedBlockades)) return false;
    used.add(native.id);
    actions.push({ type: 'UseAbility', cardId: native.id, nativeTo: { q: hex.q, r: hex.r } });
    mover = null;
    moved = true;
    plannedPosition = { q: hex.q, r: hex.r };
    return true;
  };
  // Only commit to a route the current deck can actually traverse.
  const edgeCanTraverse = (from: Hex, to: Hex) => {
    const blockade = blockadeBetween(state, from, to);
    if (!blockade || blockade.claimedBy) return true;
    if (blockadeRequiresDiscard(blockade)) return owned >= blockade.cost && (to.terrain !== 'mountain' || nativeOwned);
    const symbol = blockadeMoveSymbol(blockade);
    if (!symbol) return false;
    if (nativeOwned) return cap[symbol] >= blockade.cost;
    // One mover, one symbol: it must clear the seam AND enter the destination,
    // so the destination terrain must accept the seam symbol, with power enough
    // for both costs combined.
    const destReq = requiredFor(to);
    if (destReq !== null && destReq !== symbol) return false;
    return cap[symbol] >= blockade.cost + stepPathCost(to);
  };
  const path = pathToFinish(state, p, (h) => canTraverse(h, p, cap, owned, nativeOwned), edgeCanTraverse);
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
        const destDeduct = hex.terrain === 'eldorado' ? 0 : requiredFor(hex) === null ? 1 : enterCost(hex);
        const openedAfterThis = new Set(openedBlockades);
        openedAfterThis.add(blockade.id);
        const canNativeAfterSeam =
          available().some((c) => isNativeCard(c.defId)) &&
          canUseNativeBetween(state, p, plannedPosition, hex, openedAfterThis);
        const need = blockade.cost + (canNativeAfterSeam ? 0 : destDeduct);
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
          actions.push({ type: 'RemoveBlockade', blockadeId: blockade.id, cardId: cand.c.id, symbol: cand.sym! });
          mover = { symbol: cand.sym!, remaining: cand.pow - blockade.cost };
        }
      }
      moved = true;
      openedBlockades.add(blockade.id);
      // blockade now open in-plan: fall through to step onto `hex` by terrain.
    }

    if (hex.terrain === 'mountain') {
      if (tryUseNative(hex)) continue;
      break;
    }

    // 2) Clear a rubble/basecamp DESTINATION HEX (unchanged: enter+clear).
    if (isClear) {
      if (tryUseNative(hex)) continue;
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
    const deduct = hex.terrain === 'eldorado' ? 0 : required === null ? 1 : enterCost(hex);
    if (hex.terrain === 'eldorado') {
      actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
      moved = true;
      plannedPosition = { q: hex.q, r: hex.r };
      continue;
    }
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
    if (candidates.length === 0) {
      if (tryUseNative(hex)) continue;
      break;
    }
    const chosen = candidates[0];
    used.add(chosen.c.id);
    actions.push({ type: 'PlayMovementCard', cardId: chosen.c.id, symbol: chosen.sym! });
    actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
    mover = { symbol: chosen.sym!, remaining: chosen.pow - deduct };
    moved = true;
    plannedPosition = { q: hex.q, r: hex.r };
  }

  // --- buying ---
  const rest = available();
  const coins = rest.reduce((sum, c) => sum + coinValue(c.defId), 0);

  // What capability do we lack? Look at the ideal (unrestricted) route and find
  // the first hex our current deck can't traverse — buy toward closing that gap.
  const ideal = pathToFinish(state, p);
  let gap: Need | null = null;
  let gapPosition: Axial = { ...p.position };
  for (const h of ideal) {
    const blockade = blockadeBetween(state, gapPosition, h);
    if (blockade && !blockade.claimedBy) {
      if (blockadeRequiresDiscard(blockade)) {
        if (owned < blockade.cost) {
          gap = { symbol: null, cost: blockade.cost };
          break;
        }
      } else {
        const symbol = blockadeMoveSymbol(blockade);
        // Need enough of one symbol to clear the seam AND enter the far hex.
        const need = blockade.cost + Math.max(enterCost(h), 1);
        if (symbol && cap[symbol] < need) {
          gap = { symbol, cost: need };
          break;
        }
      }
    }
    if (!canTraverse(h, p, cap, owned, nativeOwned)) {
      gap = h.terrain === 'mountain'
        ? { symbol: null, cost: getDef('native').cost, ability: 'native' }
        : { symbol: requiredFor(h), cost: enterCost(h) };
      break;
    }
    gapPosition = { q: h.q, r: h.r };
  }

  const promotedDefId = chooseMarketPromotion(state, coins, gap);
  if (promotedDefId) actions.push({ type: 'PromoteMarket', defId: promotedDefId });

  const onBoard = state.market.filter((m) => (m.onBoard || m.defId === promotedDefId) && m.count > 0);
  const affordable = onBoard.filter((m) => getDef(m.defId).cost <= coins);

  const buyableForGap = (n: Need) =>
    affordable
      .filter((m) => matchesNeed(m.defId, n))
      .sort((a, b) => getDef(a.defId).cost - getDef(b.defId).cost);

  let target: string | null = null;
  if (gap) {
    const unblock = buyableForGap(gap);
    if (unblock.length > 0) {
      target = unblock[0].defId; // cheapest card that opens the route
    } else {
      // Can't yet afford the unblocker → build economy with the best coin card,
      // otherwise grab the cheapest movement card to widen our options.
      const econ = affordable
        .filter((m) => coinValue(m.defId) >= 1)
        .sort((a, b) => coinValue(b.defId) - coinValue(a.defId));
      const mvmt = affordable
        .filter((m) => movableSymbols(m.defId).length > 0)
        .sort((a, b) => getDef(a.defId).cost - getDef(b.defId).cost);
      if (econ.length > 0) target = econ[0].defId;
      else if (mvmt.length > 0) target = mvmt[0].defId;
    }
  } else if (affordable.length > 0) {
    // Route is fully traversable → buy the most valuable affordable card.
    target = affordable.slice().sort((a, b) => getDef(b.defId).cost - getDef(a.defId).cost)[0].defId;
  }

  if (target) {
    const cost = getDef(target).cost;
    const payment: string[] = [];
    let acc = 0;
    for (const c of rest.slice().sort((a, b) => coinValue(b.defId) - coinValue(a.defId))) {
      if (acc >= cost) break;
      payment.push(c.id);
      acc += coinValue(c.defId);
    }
    if (acc >= cost) {
      actions.push({ type: 'BuyCard', defId: target, paymentCardIds: payment });
      payment.forEach((id) => used.add(id));
    }
  }

  // If we made no progress, rest: discard the (useless this turn) hand so we
  // draw a fresh one next turn. Without this a stuck hand never cycles.
  if (!moved) {
    const cardIds = available().map((c) => c.id);
    if (cardIds.length) actions.push({ type: 'DiscardCards', cardIds });
  }

  // End-of-turn hand-cap trim: if the AI still holds more than HAND_SIZE cards
  // (e.g. bought a card on top of a full hand), discard the lowest-power excess
  // so the server doesn't have to fall back to the [AI-TRIM-SAFETY] auto-discard.
  // Uses the same lowest-power-first order as engine's autoDiscardLowestPower.
  const trimCount = p.hand.length - HAND_SIZE;
  if (trimCount > 0) {
    const toDiscard = p.hand
      .slice()
      .sort((a, b) => getDef(a.defId).power - getDef(b.defId).power)
      .slice(0, trimCount)
      .map((c) => c.id);
    if (toDiscard.length > 0) actions.push({ type: 'DiscardCards', cardIds: toDiscard });
  }

  actions.push({ type: 'EndTurn' });
  return actions;
}