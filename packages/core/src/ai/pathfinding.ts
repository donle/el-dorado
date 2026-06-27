/**
 * ai/pathfinding — cheapest-cost route from a player's position to the
 * finish hex using a custom passability test. Uses a simple O(V²) Dijkstra
 * since the map is small (~60 hexes).
 */
import type { GameState, Hex, Player, Terrain } from '../types.js';
import { key, neighbors } from '../hex.js';
import { blockadeRequiresDiscard, isFinishEntrance } from '../terrain.js';
import { blockadeBetween, stepPathCost } from './helpers.js';

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
      if (hex.terrain === 'eldorado' && !isFinishEntrance(curHex)) continue;
      const blockade = blockadeBetween(state, curHex, hex);
      // First crossing of a symbol seam pays the seam AND the destination
      // terrain; a discard seam pays only its discard; an open/absent seam pays
      // the destination terrain alone.
      const cost = blockade && !blockade.claimedBy
        ? (blockadeRequiresDiscard(blockade) ? blockade.cost : blockade.cost + stepPathCost(hex))
        : stepPathCost(hex);
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