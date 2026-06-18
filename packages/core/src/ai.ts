/**
 * Greedy heuristic AI.
 *
 * 1. Pathfind to El Dorado minimising total terrain cost (Dijkstra), so the
 *    AI prefers cheap routes it can actually afford.
 * 2. Walk that path with the cheapest sufficient cards.
 * 3. If a hex blocks it, buy the cheapest market card that would let it enter
 *    (matching symbol / joker, power ≥ cost); otherwise build economy by
 *    buying the most valuable affordable card.
 *
 * `planTurn` returns a full action sequence (ending in EndTurn) that the
 * server applies through the same validated reducer humans use.
 */
import type { GameState, Player, Hex, MoveSymbol, Terrain } from './types.js';
import type { Action } from './actions.js';
import { getDef, coinValue, movableSymbols } from './cards.js';
import { neighbors, key } from './hex.js';

function terrainSymbol(t: Terrain): MoveSymbol | null {
  if (t === 'green') return 'machete';
  if (t === 'blue') return 'paddle';
  if (t === 'yellow') return 'coin';
  return null;
}

function enterCost(h: Hex): number {
  return h.terrain === 'start' || h.terrain === 'finish' ? 1 : h.cost;
}

/** Lowest-cost hex path from start to any finish, avoiding mountains/occupants. */
export function pathToFinish(state: GameState, p: Player): Hex[] {
  const byKey = new Map(state.hexes.map((h) => [key(h), h]));
  const blocked = (h: Hex) =>
    h.terrain === 'mountain' || (!!h.occupant && h.occupant !== p.id);

  const startKey = key(p.position);
  const dist = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string | null>([[startKey, null]]);
  const visited = new Set<string>();

  let goal: string | null = null;
  // Small graph → a simple O(V^2) Dijkstra is plenty.
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [k, d] of dist) {
      if (!visited.has(k) && d < best) {
        best = d;
        cur = k;
      }
    }
    if (cur === null) break;
    visited.add(cur);
    const curHex = byKey.get(cur)!;
    if (curHex.terrain === 'finish') {
      goal = cur;
      break;
    }
    for (const n of neighbors(curHex)) {
      const k = key(n);
      const hex = byKey.get(k);
      if (!hex || blocked(hex) || visited.has(k)) continue;
      const nd = best + Math.max(enterCost(hex), 1);
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        prev.set(k, cur);
      }
    }
  }
  if (!goal) return [];

  const path: Hex[] = [];
  let at: string | null = goal;
  while (at && at !== startKey) {
    path.unshift(byKey.get(at)!);
    at = prev.get(at) ?? null;
  }
  return path;
}

function declareSymbol(defId: string, required: MoveSymbol | null): MoveSymbol | null {
  const can = movableSymbols(defId);
  if (can.length === 0) return null;
  if (required === null) return can[0];
  return can.includes(required) ? required : null;
}

interface Need {
  symbol: MoveSymbol | null;
  cost: number;
}

export function planTurn(state: GameState, playerId: string): Action[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return [{ type: 'EndTurn' }];

  const actions: Action[] = [];
  const used = new Set<string>();
  const available = () => p.hand.filter((c) => !used.has(c.id));
  let mover: { symbol: MoveSymbol; remaining: number } | null = null;
  let need: Need | null = null;
  let moved = false;

  const path = pathToFinish(state, p);
  for (const hex of path) {
    const required = terrainSymbol(hex.terrain);
    const isClear = hex.terrain === 'rubble' || hex.terrain === 'basecamp';

    if (isClear) {
      const pick = available()
        .slice()
        .sort((a, b) => getDef(a.defId).power - getDef(b.defId).power)
        .slice(0, hex.cost);
      if (pick.length < hex.cost) break; // not enough cards in hand this turn
      pick.forEach((c) => used.add(c.id));
      actions.push({ type: 'ClearSpace', to: { q: hex.q, r: hex.r }, cardIds: pick.map((c) => c.id) });
      mover = null;
      moved = true;
      continue;
    }

    const deduct = required === null ? 1 : hex.cost;

    if (mover && mover.remaining >= deduct && (required === null || required === mover.symbol)) {
      actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
      mover.remaining -= deduct;
      moved = true;
      continue;
    }

    const candidates = available()
      .map((c) => ({ c, sym: declareSymbol(c.defId, required), pow: getDef(c.defId).power }))
      .filter((x) => x.sym !== null && x.pow >= deduct)
      .sort((a, b) => a.pow - b.pow);
    if (candidates.length === 0) {
      need = { symbol: required, cost: deduct };
      break;
    }

    const chosen = candidates[0];
    used.add(chosen.c.id);
    actions.push({ type: 'PlayMovementCard', cardId: chosen.c.id, symbol: chosen.sym! });
    actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
    mover = { symbol: chosen.sym!, remaining: chosen.pow - deduct };
    moved = true;
  }

  // --- buying ---
  const rest = available();
  const coins = rest.reduce((sum, c) => sum + coinValue(c.defId), 0);
  const onBoard = state.market.filter((m) => m.onBoard && m.count > 0);

  const buyableEntering = (n: Need) =>
    onBoard
      .filter((m) => {
        const d = getDef(m.defId);
        if (d.cost > coins) return false;
        const syms = movableSymbols(d.defId);
        const ok = n.symbol === null ? syms.length > 0 : syms.includes(n.symbol);
        return ok && d.power >= n.cost;
      })
      .sort((a, b) => getDef(a.defId).cost - getDef(b.defId).cost);

  let target: string | null = null;
  if (need) {
    const unblock = buyableEntering(need);
    if (unblock.length > 0) {
      target = unblock[0].defId; // cheapest card that unblocks us
    } else {
      // Can't afford the unblocker yet → build economy with the best coin card.
      const econ = onBoard
        .filter((m) => getDef(m.defId).cost <= coins && coinValue(m.defId) >= 1)
        .sort((a, b) => coinValue(b.defId) - coinValue(a.defId));
      if (econ.length > 0) target = econ[0].defId;
    }
  } else {
    // Already moved as far as planned → buy the most valuable affordable card.
    const best = onBoard
      .filter((m) => getDef(m.defId).cost <= coins)
      .sort((a, b) => getDef(b.defId).cost - getDef(a.defId).cost);
    if (best.length > 0) target = best[0].defId;
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
  const discardCardIds = moved ? undefined : available().map((c) => c.id);
  actions.push({ type: 'EndTurn', discardCardIds });
  return actions;
}
