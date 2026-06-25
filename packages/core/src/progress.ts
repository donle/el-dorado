/**
 * Pure-function "progress" math shared between client rendering and any
 * server-side analytics that need it later.
 *
 * `progressOf` is intentionally a free function (not a method on a class
 * and not tied to React / DOM state) so it can be unit-tested and reused
 * without dragging in app-level dependencies.
 */
import type { Axial, GameState } from './types.js';
import { distance } from './hex.js';
import { isFinishEntrance } from './terrain.js';

/**
 * Rough progress 0..1 toward El Dorado, for the player roster bars.
 *
 * Returns 0 when the map has no finish / entrance, 1 when `p.finished` is
 * true, otherwise the linear distance from the player's current position
 * to the nearest finish, normalized by the longest possible path from
 * any start hex to any finish.
 */
export function progressOf(
  p: { position: Axial; finished: boolean },
  state: GameState,
): number {
  if (p.finished) return 1;
  const finishes = state.hexes.some((h) => h.terrain === 'eldorado')
    ? state.hexes.filter((h) => h.terrain === 'eldorado')
    : state.hexes.filter((h) => isFinishEntrance(h));
  const starts = state.hexes.filter((h) => h.terrain === 'start');
  if (!finishes.length) return 0;
  const toFinish = (pos: Axial) => Math.min(...finishes.map((f) => distance(pos, f)));
  const ref = starts.length ? Math.max(...starts.map((st) => toFinish(st))) : 1;
  return Math.max(0, Math.min(1, 1 - toFinish(p.position) / Math.max(ref, 1)));
}
