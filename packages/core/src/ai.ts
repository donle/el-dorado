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
import type { GameState, Player, Hex, MoveSymbol, Terrain, Axial, Blockade } from './types.js';
import type { Action } from './actions.js';
import { getDef, coinValue, movableSymbols } from './cards.js';
import { neighbors, key } from './hex.js';

function terrainSymbol(t: Terrain): MoveSymbol | null {
  if (t === 'green') return 'machete';
  if (t === 'blue') return 'paddle';
  if (t === 'yellow') return 'coin';
  return null;
}

function blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null {
  return terrainSymbol(blockade.terrain) ?? blockade.symbol ?? null;
}

function blockadeRequiresDiscard(blockade: Blockade): boolean {
  return blockade.terrain === 'rubble' || blockadeMoveSymbol(blockade) === null;
}

/** Symbol a hex demands to enter (El Dorado entrances may require coin). */
function requiredFor(h: Hex): MoveSymbol | null {
  if (h.terrain === 'finish') return h.reqSymbol ?? null;
  return terrainSymbol(h.terrain);
}

function enterCost(h: Hex): number {
  if (h.terrain === 'start') return 1;
  if (h.terrain === 'eldorado') return 1;
  if (h.terrain === 'finish') return Math.max(h.cost, 1);
  return h.cost;
}

function sameCoord(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

function crossesBlockadeEdge(blockade: Blockade, from: Axial, to: Axial): boolean {
  const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  return edges.some(
    (edge) =>
      (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
  );
}

function blockadeBetween(state: GameState, from: Axial, to: Axial): Blockade | undefined {
  return state.blockades.find((b) => crossesBlockadeEdge(b, from, to));
}

type Capability = Record<MoveSymbol, number>;

/** Best single-card power the player can field for each symbol (jokers count for all). */
function capability(p: Player): Capability {
  const cap: Capability = { machete: 0, paddle: 0, coin: 0 };
  for (const c of [...p.deck, ...p.hand, ...p.discard]) {
    const def = getDef(c.defId);
    for (const s of movableSymbols(def.defId)) {
      if (def.power > cap[s]) cap[s] = def.power;
    }
  }
  return cap;
}

/** Whether the player could enter `h` at all given a capability + owned-card count. */
function canTraverse(h: Hex, p: Player, cap: Capability, owned: number): boolean {
  if (h.terrain === 'mountain') return false;
  if (h.occupant && h.occupant !== p.id) return false;
  if (h.terrain === 'eldorado') return cap.machete + cap.paddle + cap.coin > 0;
  if (h.terrain === 'rubble' || h.terrain === 'basecamp') return owned >= h.cost;
  if (h.terrain === 'green') return cap.machete >= h.cost;
  if (h.terrain === 'blue') return cap.paddle >= h.cost;
  if (h.terrain === 'yellow') return cap.coin >= h.cost;
  if (h.terrain === 'finish') {
    return h.reqSymbol ? cap[h.reqSymbol] >= Math.max(h.cost, 1) : cap.machete + cap.paddle + cap.coin > 0;
  }
  return cap.machete + cap.paddle + cap.coin > 0; // start
}

/** Lowest-cost hex path from start to El Dorado using a custom passability test. */
export function pathToFinish(
  state: GameState,
  p: Player,
  passable: (h: Hex) => boolean = (h) =>
    h.terrain !== 'mountain' &&
    (!h.occupant || h.occupant === p.id),
  edgePassable: (from: Hex, to: Hex) => boolean = () => true,
): Hex[] {
  const targetTerrain: Terrain = state.hexes.some((h) => h.terrain === 'eldorado') ? 'eldorado' : 'finish';
  const byKey = new Map(state.hexes.map((h) => [key(h), h]));
  const blocked = (h: Hex) => !passable(h);

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
    if (curHex.terrain === targetTerrain) {
      goal = cur;
      break;
    }
    for (const n of neighbors(curHex)) {
      const k = key(n);
      const hex = byKey.get(k);
      if (!hex || blocked(hex) || visited.has(k)) continue;
      if (!edgePassable(curHex, hex)) continue;
      if (hex.terrain === 'eldorado' && curHex.terrain !== 'finish') continue;
      const blockade = blockadeBetween(state, curHex, hex);
      const cost = blockade && !blockade.claimedBy ? blockade.cost : Math.max(enterCost(hex), 1);
      const nd = best + cost;
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
  let moved = false;

  const cap = capability(p);
  const owned = p.deck.length + p.hand.length + p.discard.length;
  // Only commit to a route the current deck can actually traverse.
  const edgeCanTraverse = (from: Hex, to: Hex) => {
    const blockade = blockadeBetween(state, from, to);
    if (!blockade || blockade.claimedBy) return true;
    if (blockadeRequiresDiscard(blockade)) return owned >= blockade.cost;
    const symbol = blockadeMoveSymbol(blockade);
    return !!symbol && cap[symbol] >= blockade.cost;
  };
  const path = pathToFinish(state, p, (h) => canTraverse(h, p, cap, owned), edgeCanTraverse);
  let plannedPosition: Axial = { ...p.position };
  for (const hex of path) {
    const blockade = blockadeBetween(state, plannedPosition, hex);
    const blockadeClear = !!blockade && !blockade.claimedBy && blockadeRequiresDiscard(blockade);
    const required = blockade && !blockade.claimedBy && !blockadeClear ? blockadeMoveSymbol(blockade) : requiredFor(hex);
    const isClear = hex.terrain === 'rubble' || hex.terrain === 'basecamp';

    if (blockadeClear || isClear) {
      const cost = blockadeClear ? blockade.cost : hex.cost;
      const pick = available()
        .slice()
        .sort((a, b) => getDef(a.defId).power - getDef(b.defId).power)
        .slice(0, cost);
      if (pick.length < cost) break; // not enough cards in hand this turn
      pick.forEach((c) => used.add(c.id));
      actions.push({ type: 'ClearSpace', to: { q: hex.q, r: hex.r }, cardIds: pick.map((c) => c.id) });
      mover = null;
      moved = true;
      plannedPosition = { q: hex.q, r: hex.r };
      continue;
    }

    const deduct = blockade && !blockade.claimedBy ? blockade.cost : required === null ? 1 : enterCost(hex);

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
    if (candidates.length === 0) break; // traversable, but not with this turn's hand

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
  const onBoard = state.market.filter((m) => m.onBoard && m.count > 0);
  const affordable = onBoard.filter((m) => getDef(m.defId).cost <= coins);

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
        if (symbol && cap[symbol] < blockade.cost) {
          gap = { symbol, cost: blockade.cost };
          break;
        }
      }
    }
    if (!canTraverse(h, p, cap, owned)) {
      gap = { symbol: requiredFor(h), cost: enterCost(h) };
      break;
    }
    gapPosition = { q: h.q, r: h.r };
  }

  const buyableForGap = (n: Need) =>
    affordable
      .filter((m) => {
        const d = getDef(m.defId);
        const syms = movableSymbols(d.defId);
        const ok = n.symbol === null ? syms.length > 0 : syms.includes(n.symbol);
        return ok && d.power >= n.cost;
      })
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
  const discardCardIds = moved ? undefined : available().map((c) => c.id);
  actions.push({ type: 'EndTurn', discardCardIds });
  return actions;
}
