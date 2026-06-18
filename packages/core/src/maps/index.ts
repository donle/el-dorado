import type { GameMap } from '../types.js';
import { parseGrid } from './parse.js';

/**
 * "Classic" map: a wide hex field (like the real game's assembled tiles)
 * shaped by mountain walls into a winding route. 4 start hexes on the left,
 * 3 El Dorado hexes on the right, terrain clustered into jungle / river /
 * village regions with base camps (C) and rubble (R) along the way.
 *
 * Mountains at rows 2 & 4 (cols 4,7,10) form partial walls, leaving the
 * middle row and the top/bottom rows open — so there are several routes.
 */
export const CLASSIC_MAP: GameMap = parseGrid('classic', 'Lost Valley', [
  '-- g1 g2 b1 b2 y1 y2 g2 b2 y1 g2 b3 y2 g3 b2 --',
  'S1 g2 g1 b2 b1 y2 g1 b2 y2 g3 b1 y2 g2 b2 g3 --',
  'S2 g1 R2 b1 MM y1 g2 MM y3 g2 MM b2 C2 g3 b2 F1',
  'S3 g2 g1 b2 b3 y2 g3 b1 y2 g1 b2 y3 g2 b2 g3 F2',
  'S4 g1 b2 R2 MM g2 y1 MM g3 y2 MM g2 C2 b2 g2 F3',
  '-- g2 g1 b1 b2 y2 g2 b2 y1 g3 b2 y2 g2 g3 b2 --',
  '-- g1 g2 b2 g1 y1 b2 g2 y2 g2 b3 y3 g2 b2 g3 --',
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
