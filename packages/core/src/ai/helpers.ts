/**
 * ai/helpers — pure terrain/path/capability utilities shared across the
 * ai/ tree. Kept dependency-free so pathfinding / market / planner can
 * import without forming cycles.
 */
import type { Axial, Blockade, GameState, Hex, MoveSymbol, Player } from '../types.js';
import { getDef, movableSymbols } from '../cards.js';
import { neighbors } from '../hex.js';
import { isFinishEntrance, sameCoord } from '../terrain.js';

export function enterCost(h: Hex): number {
  if (h.terrain === 'start') return 1;
  if (h.terrain === 'eldorado') return 0;
  if (h.terrain === 'finish') return Math.max(h.cost, 1);
  return h.cost;
}

export function stepPathCost(h: Hex): number {
  return h.terrain === 'eldorado' ? 0 : Math.max(enterCost(h), 1);
}

function crossesBlockadeEdge(blockade: Blockade, from: Axial, to: Axial): boolean {
  const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  return edges.some(
    (edge) =>
      (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
  );
}

export function blockadeBetween(state: GameState, from: Axial, to: Axial): Blockade | undefined {
  return state.blockades.find((b) => crossesBlockadeEdge(b, from, to));
}

function hexAt(state: GameState, c: Axial): Hex | undefined {
  return state.hexes.find((h) => h.q === c.q && h.r === c.r);
}

function isAdjacentCoord(a: Axial, b: Axial): boolean {
  return neighbors(a).some((n) => sameCoord(n, b));
}

export function canUseNativeBetween(
  state: GameState,
  p: Player,
  from: Axial,
  to: Hex,
  openedBlockades: Set<string>,
): boolean {
  if (!isAdjacentCoord(from, to)) return false;
  if (to.occupant && to.occupant !== p.id) return false;
  const fromHex = hexAt(state, from);
  if (to.terrain === 'eldorado' && !isFinishEntrance(fromHex ?? to)) return false;
  const blockade = blockadeBetween(state, from, to);
  return !blockade || !!blockade.claimedBy || openedBlockades.has(blockade.id);
}

export type Capability = Record<MoveSymbol, number>;

export function isNativeCard(defId: string): boolean {
  return getDef(defId).ability === 'native';
}

/** Best single-card power the player can field for each symbol (jokers count for all). */
export function capability(p: Player): Capability {
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
export function canTraverse(h: Hex, p: Player, cap: Capability, owned: number, hasNative: boolean): boolean {
  if (h.occupant && h.occupant !== p.id) return false;
  if (hasNative) return true;
  if (h.terrain === 'mountain') return false;
  if (h.terrain === 'eldorado') return true;
  if (h.terrain === 'rubble' || h.terrain === 'basecamp') return owned >= h.cost;
  if (h.terrain === 'green') return cap.machete >= h.cost;
  if (h.terrain === 'blue') return cap.paddle >= h.cost;
  if (h.terrain === 'yellow') return cap.coin >= h.cost;
  if (h.terrain === 'finish') {
    return h.reqSymbol ? cap[h.reqSymbol] >= Math.max(h.cost, 1) : cap.machete + cap.paddle + cap.coin > 0;
  }
  return cap.machete + cap.paddle + cap.coin > 0; // start
}

export function declareSymbol(defId: string, required: MoveSymbol | null): MoveSymbol | null {
  const can = movableSymbols(defId);
  if (can.length === 0) return null;
  if (required === null) return can[0];
  return can.includes(required) ? required : null;
}

export interface Need {
  symbol: MoveSymbol | null;
  cost: number;
  ability?: 'native';
}