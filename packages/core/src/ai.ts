/**
 * Greedy heuristic AI: walk the shortest path toward El Dorado using the
 * cheapest sufficient cards, then buy the best affordable card.
 *
 * `planTurn` returns a full action sequence (ending in EndTurn) that the
 * server applies in order through the same validated reducer humans use.
 */
import type { GameState, Player, Hex, Axial, MoveSymbol, Terrain } from './types.js';
import type { Action } from './actions.js';
import { getDef, coinValue, movableSymbols } from './cards.js';
import { neighbors, key } from './hex.js';

function terrainSymbol(t: Terrain): MoveSymbol | null {
  if (t === 'green') return 'machete';
  if (t === 'blue') return 'paddle';
  if (t === 'yellow') return 'coin';
  return null;
}

/** Shortest hex path from start to any finish, avoiding mountains/occupants. */
function pathToFinish(state: GameState, p: Player): Hex[] {
  const byKey = new Map(state.hexes.map((h) => [key(h), h]));
  const blocked = (h: Hex) =>
    h.terrain === 'mountain' || (!!h.occupant && h.occupant !== p.id);

  const startKey = key(p.position);
  const prev = new Map<string, string | null>([[startKey, null]]);
  const queue: Axial[] = [p.position];
  let goal: string | null = null;

  while (queue.length) {
    const cur = queue.shift()!;
    const curHex = byKey.get(key(cur))!;
    if (curHex.terrain === 'finish') {
      goal = key(cur);
      break;
    }
    for (const n of neighbors(cur)) {
      const k = key(n);
      const hex = byKey.get(k);
      if (!hex || prev.has(k) || blocked(hex)) continue;
      prev.set(k, key(cur));
      queue.push(n);
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

/** Which symbol to declare to enter `required` terrain with `defId`, or null. */
function declareSymbol(defId: string, required: MoveSymbol | null): MoveSymbol | null {
  const can = movableSymbols(defId);
  if (can.length === 0) return null;
  if (required === null) return can[0]; // wildcard (start/finish)
  return can.includes(required) ? required : null;
}

export function planTurn(state: GameState, playerId: string): Action[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return [{ type: 'EndTurn' }];

  const actions: Action[] = [];
  const used = new Set<string>();
  const available = () => p.hand.filter((c) => !used.has(c.id));
  let mover: { symbol: MoveSymbol; remaining: number } | null = null;

  const path = pathToFinish(state, p);
  for (const hex of path) {
    const required = terrainSymbol(hex.terrain);
    const isClear = hex.terrain === 'rubble' || hex.terrain === 'basecamp';

    if (isClear) {
      const pick = available()
        .slice()
        .sort((a, b) => getDef(a.defId).power - getDef(b.defId).power)
        .slice(0, hex.cost);
      if (pick.length < hex.cost) break;
      pick.forEach((c) => used.add(c.id));
      actions.push({ type: 'ClearSpace', to: { q: hex.q, r: hex.r }, cardIds: pick.map((c) => c.id) });
      mover = null;
      continue;
    }

    const deduct = required === null ? 1 : hex.cost;

    // Use leftover power from the active card if it fits.
    if (mover && mover.remaining >= deduct && (required === null || required === mover.symbol)) {
      actions.push({ type: 'StepTo', to: { q: hex.q, r: hex.r } });
      mover.remaining -= deduct;
      continue;
    }

    // Otherwise play the cheapest sufficient card.
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
  }

  // Buy the most expensive affordable on-board card with leftover cards.
  const rest = available();
  const coins = rest.reduce((sum, c) => sum + coinValue(c.defId), 0);
  const affordable = state.market
    .filter((m) => m.onBoard && m.count > 0 && getDef(m.defId).cost <= coins)
    .sort((a, b) => getDef(b.defId).cost - getDef(a.defId).cost);
  if (affordable.length > 0) {
    const target = affordable[0];
    const cost = getDef(target.defId).cost;
    const payment: string[] = [];
    let acc = 0;
    for (const c of rest.slice().sort((a, b) => coinValue(b.defId) - coinValue(a.defId))) {
      if (acc >= cost) break;
      payment.push(c.id);
      acc += coinValue(c.defId);
    }
    if (acc >= cost) {
      actions.push({ type: 'BuyCard', defId: target.defId, paymentCardIds: payment });
    }
  }

  actions.push({ type: 'EndTurn' });
  return actions;
}
