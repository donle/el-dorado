import type { GameMap } from '../types.js';
import { parseGrid } from './parse.js';

/**
 * "Classic" MVP map: a 2-lane corridor from 4 start hexes to El Dorado.
 * Lane A = top row, Lane B = bottom row. A mountain at one point forces
 * players to share the open lane.
 */
export const CLASSIC_MAP: GameMap = parseGrid('classic', 'Classic Trail', [
  'S1 S3 g1 g2 b1 b2 y1 R2 g3 y2 b3 g2 C2 y3 g4 b3 g2 F1 F3',
  'S2 S4 g1 g1 g2 b1 y2 g2 b2 y1 MM g3 y2 b2 g2 y3 b2 F2 --',
]);

export const MAPS: Record<string, GameMap> = {
  classic: CLASSIC_MAP,
};

export function getMap(id: string): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`Unknown map: ${id}`);
  return m;
}

export { parseGrid };
