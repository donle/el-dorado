import type { GameMap } from '../types.js';
import { parseGrid } from './parse.js';
import { buildTileMap } from './tile.js';

/**
 * "Classic" map: assembled from continent tiles, exactly like the physical
 * game. Each tile is a side-4 hexagon (37 cells); tiles connect edge-to-edge
 * along a winding path: start → jungle → river → village → El Dorado.
 * Start hexes sit on the back edge of the start tile; the route ends at three
 * El Dorado entrance hexes, then a compact golden city terminal.
 */
// Each tile attaches to the next along a named, semantic edge — varying the
// seam (up / right-up / right-down / down) gives an arcing, winding trail
// rather than a regular zigzag. Verified overlap-free with no accidental
// non-consecutive adjacency.
export const CLASSIC_MAP: GameMap = buildTileMap('classic', '黄金城之路', [
  { theme: 'start', connect: 'up' },
  { theme: 'jungle', connect: 'right-up' },
  { theme: 'river', connect: 'right-down' },
  { theme: 'village', connect: 'down' },
  { theme: 'end' },
]);

/** Simple 2-lane corridor — used by unit tests with fixed coordinates. */
export const CORRIDOR_MAP: GameMap = parseGrid('corridor', '测试走廊', [
  'S1 S3 g1 g2 b1 b2 y1 R2 g3 y2 b3 g2 C2 y3 g4 b3 g2 F1 F3',
  'S2 S4 g1 g1 g2 b1 y2 g2 b2 y1 MM g3 y2 b2 g2 y3 b2 F2 --',
]);

export const MAPS: Record<string, GameMap> = {
  classic: CLASSIC_MAP,
  corridor: CORRIDOR_MAP,
};

export function getMap(id: string): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`未知地图：${id}`);
  return m;
}

export { parseGrid };
export {
  buildTileMap,
  assembleTiles,
  neighborCenter,
  TILE_RADIUS,
  TILE_EDGES,
  EDGE_OFFSET,
  OPPOSITE_EDGE,
  TILE_NEIGHBOR_OFFSETS,
} from './tile.js';
export type { TileEdge, TileTheme, TileSpec, PlacedTile } from './tile.js';
