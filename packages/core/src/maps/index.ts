import type { GameMap } from '../types.js';
import { parseGrid } from './parse.js';
import { buildTileMap } from './tile.js';

/**
 * "Classic" map: assembled from continent tiles, exactly like the physical
 * game. Each tile is a side-4 hexagon (37 cells); tiles connect edge-to-edge
 * along a winding path: start → jungle → river → village → El Dorado.
 * Start hexes sit on the back edge of the start tile, the 3 finish hexes on
 * the far edge of the end tile.
 */
// Directions vary across all four edge types (offsets 5,0,1,2) so the tiles
// join on different sides — an arcing, winding trail rather than a regular
// zigzag. Verified overlap-free with no accidental non-consecutive adjacency.
export const CLASSIC_MAP: GameMap = buildTileMap('classic', 'El Dorado Trail', [
  { theme: 'start', dir: 5 },
  { theme: 'jungle', dir: 0 },
  { theme: 'river', dir: 1 },
  { theme: 'village', dir: 2 },
  { theme: 'end' },
]);

/** Simple 2-lane corridor — used by unit tests with fixed coordinates. */
export const CORRIDOR_MAP: GameMap = parseGrid('corridor', 'Corridor', [
  'S1 S3 g1 g2 b1 b2 y1 R2 g3 y2 b3 g2 C2 y3 g4 b3 g2 F1 F3',
  'S2 S4 g1 g1 g2 b1 y2 g2 b2 y1 MM g3 y2 b2 g2 y3 b2 F2 --',
]);

export const MAPS: Record<string, GameMap> = {
  classic: CLASSIC_MAP,
  corridor: CORRIDOR_MAP,
};

export function getMap(id: string): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}

export { parseGrid };
export { buildTileMap, TILE_RADIUS, TILE_NEIGHBOR_OFFSETS } from './tile.js';
