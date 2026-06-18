/**
 * Deterministic, seedable RNG (mulberry32).
 *
 * The engine threads an integer `rngState` through GameState so that shuffles
 * are reproducible — essential for testing and for server/client agreement.
 */

/** Advance the state and return [nextState, floatIn[0,1)]. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
  const value = ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  return [t >>> 0, value];
}

/** Fisher–Yates shuffle returning a new array and the advanced rng state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const arr = items.slice();
  let s = state;
  for (let i = arr.length - 1; i > 0; i--) {
    let rand: number;
    [s, rand] = nextRandom(s);
    const j = Math.floor(rand * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return [arr, s];
}
