import { describe, it, expect } from 'vitest';
import { progressOf } from '../src/progress.js';
import type { GameState, Hex } from '../src/types.js';

/** Build a minimal GameState-ish object (the helper only reads `state.hexes`). */
function makeState(hexes: Hex[]): GameState {
  return { hexes } as unknown as GameState;
}

function hex(q: number, r: number, terrain: Hex['terrain']): Hex {
  return { q, r, terrain, cost: 0 } as Hex;
}

describe('progressOf', () => {
  it('returns 1 when the player has finished', () => {
    const state = makeState([hex(0, 0, 'start'), hex(5, 0, 'finish')]);
    expect(progressOf({ position: { q: 1, r: 0 }, finished: true }, state)).toBe(1);
  });

  it('returns 0 when the map has no finish and no finish-entrance', () => {
    const state = makeState([hex(0, 0, 'start'), hex(1, 0, 'green')]);
    expect(progressOf({ position: { q: 1, r: 0 }, finished: false }, state)).toBe(0);
  });

  it('returns 0 at the start when the player is at the only start hex', () => {
    // Start at (0,0), finish at (10,0). Furthest start from finish = 10. So
    // 1 - 10/10 = 0.
    const state = makeState([hex(0, 0, 'start'), hex(10, 0, 'finish')]);
    expect(progressOf({ position: { q: 0, r: 0 }, finished: false }, state)).toBe(0);
  });

  it('returns 1 when the player is on the finish hex', () => {
    const state = makeState([hex(0, 0, 'start'), hex(10, 0, 'finish')]);
    expect(progressOf({ position: { q: 10, r: 0 }, finished: false }, state)).toBe(1);
  });

  it('prefers El Dorado tiles over finish-entrance hexes when both exist', () => {
    // finish-entrance at (5,0), El Dorado at (10,0). Furthest start is 10.
    // At (10,0) the distance to El Dorado is 0, so progress = 1 - 0/10 = 1.
    const state = makeState([
      hex(0, 0, 'start'),
      { q: 5, r: 0, terrain: 'green', cost: 0, finishEntrance: true } as Hex,
      hex(10, 0, 'eldorado'),
    ]);
    expect(progressOf({ position: { q: 10, r: 0 }, finished: false }, state)).toBe(1);
  });
});
