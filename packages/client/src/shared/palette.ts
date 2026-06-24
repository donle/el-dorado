import type { MoveSymbol, PlayerColor, Terrain } from '@eldorado/core';

/**
 * Shared colour tables for the 3D board.
 *
 * P1 typed: every map is keyed by a closed union from `@eldorado/core`, so
 * adding a new variant to the union forces a compile error here. String
 * literals never appear scattered through scene code.
 */

/** Side (vertical) face colour for a terrain hex. */
export const TERRAIN_SIDE_COLOR: Record<Terrain, number> = {
  green: 0x24482e,
  blue: 0x1d5668,
  yellow: 0x8b7138,
  rubble: 0x55585a,
  basecamp: 0x6b3d31,
  mountain: 0x20242a,
  start: 0x3f4852,
  finish: 0x9b7430,
  eldorado: 0x87662b,
};

/** Player piece colour. */
export const PLAYER_COLOR: Record<PlayerColor, number> = {
  red: 0xe05656,
  blue: 0x4c9bef,
  green: 0x5ed17a,
  yellow: 0xf0d24c,
};

/**
 * Tint applied to the top of a blockade tile per movement symbol.
 * P1 typed: only `machete` / `paddle` / `coin` — no stale entries for
 * pseudo-symbols like 'discard' / 'remove'.
 */
export const BLOCKADE_COLOR: Record<MoveSymbol, number> = {
  machete: 0x3d9c62,
  paddle: 0x2c8fbd,
  coin: 0xd6a73b,
};

/**
 * The four terrain kinds that can host a blockade (`green` / `blue` / `yellow`
 * / `rubble`). Other terrains (mountain, start, finish, etc.) are never
 * blocked, so they're absent from the blockade colour tables.
 */
export type BlockadeTerrain = 'green' | 'blue' | 'yellow' | 'rubble';

/** Top-face tint applied to a blockade hex. P1 typed over the blockade domain. */
export const BLOCKADE_TOP_TINT: Record<BlockadeTerrain, number> = {
  green: 0xc4d0a1,
  blue: 0xb7ccd0,
  yellow: 0xd6b86c,
  rubble: 0xb29a82,
};

/** Side (vertical) face colour for a blockade hex. P1 typed. */
export const BLOCKADE_SIDE_COLOR: Record<BlockadeTerrain, number> = {
  green: 0x355f36,
  blue: 0x376b75,
  yellow: 0x8b692e,
  rubble: 0x68503e,
};

/** Outline / band / pattern accent colour for a blockade hex. P1 typed. */
export const BLOCKADE_MARK_COLOR: Record<BlockadeTerrain, number> = {
  green: 0x214a2a,
  blue: 0x235a66,
  yellow: 0x6f511e,
  rubble: 0x4d3a2f,
};

/**
 * Look up a `BlockadeTerrain`-keyed colour for an arbitrary hex `terrain`.
 * Hexes that don't host blockades (mountain, start, finish, eldorado, etc.)
 * fall through to the caller-supplied `fallback`. The original loose
 * `Record<string, number>` indexing collapsed this branch into a `?? 0x...`
 * expression; the typed form makes the fallback explicit.
 */
export function blockadeColor<T>(
  terrain: Terrain,
  table: Record<BlockadeTerrain, T>,
  fallback: T,
): T {
  return terrain in table ? table[terrain as BlockadeTerrain] : fallback;
}
