/**
 * Tile-based map composition — faithful to the physical game.
 *
 * - Smallest unit: one hex cell.
 * - One "continent tile" is a regular hexagon of hexes with side length 4 =
 *   37 cells (all cells within cube-distance 3 of the tile centre).
 * - Tiles connect edge-to-edge to form the full route. Two side-4 hexagons
 *   placed at a neighbour offset share a 7-cell border with zero overlap.
 */
import type { GameMap, Hex, Terrain, Axial } from '../types.js';
import { key } from '../hex.js';

export const TILE_RADIUS = 3; // side length 4 → 37 cells

/** Centre-to-centre offsets to the 6 edge-adjacent tiles (rotations of (7,-3)). */
export const TILE_NEIGHBOR_OFFSETS: Axial[] = [
  { q: 7, r: -3 },
  { q: 3, r: 4 },
  { q: -4, r: 7 },
  { q: -7, r: 3 },
  { q: -3, r: -4 },
  { q: 4, r: -7 },
];

export type TileTheme = 'start' | 'jungle' | 'river' | 'village' | 'end';

/** Local cells of a tile (centre at 0,0): 37 axial coords. */
function localCells(): Axial[] {
  const out: Axial[] = [];
  for (let dq = -TILE_RADIUS; dq <= TILE_RADIUS; dq++) {
    const lo = Math.max(-TILE_RADIUS, -dq - TILE_RADIUS);
    const hi = Math.min(TILE_RADIUS, -dq + TILE_RADIUS);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: dq, r: dr });
  }
  return out;
}

const PRIMARY: Record<TileTheme, Terrain> = {
  start: 'green',
  jungle: 'green',
  river: 'blue',
  village: 'yellow',
  end: 'green',
};
const SECONDARY: Record<TileTheme, Terrain> = {
  start: 'yellow',
  jungle: 'blue',
  river: 'green',
  village: 'green',
  end: 'yellow',
};

/** Interior special cells per theme: mountains / rubble / base camps. */
const SPECIALS: Record<TileTheme, Array<{ q: number; r: number; terrain: Terrain }>> = {
  start: [],
  jungle: [
    { q: 1, r: 0, terrain: 'mountain' },
    { q: -1, r: 1, terrain: 'basecamp' },
  ],
  river: [
    { q: 0, r: 1, terrain: 'mountain' },
    { q: 1, r: -1, terrain: 'rubble' },
  ],
  village: [
    { q: 0, r: 0, terrain: 'basecamp' },
    { q: -1, r: 0, terrain: 'rubble' },
  ],
  end: [
    { q: 1, r: 0, terrain: 'mountain' },
    { q: 0, r: 1, terrain: 'mountain' },
  ],
};

interface CellSpec {
  terrain: Terrain;
  cost: number;
  slot?: number;
}

function cellSpec(theme: TileTheme, dq: number, dr: number): CellSpec {
  // Start hexes: the back edge (dq = -3, four cells dr 0..3) → slots 1..4.
  if (theme === 'start' && dq === -TILE_RADIUS) {
    return { terrain: 'start', cost: 0, slot: dr + 1 };
  }
  // Finish hexes: the far edge (dq = +3, three cells dr -2..0) → El Dorado.
  if (theme === 'end' && dq === TILE_RADIUS && dr >= -2 && dr <= 0) {
    return { terrain: 'finish', cost: 0, slot: dr + 3 };
  }
  // Interior specials (only placed at ring <= 2, so connecting edges stay open).
  const sp = SPECIALS[theme].find((s) => s.q === dq && s.r === dr);
  if (sp) {
    const cost = sp.terrain === 'mountain' ? 0 : 2;
    return { terrain: sp.terrain, cost };
  }
  // Base terrain: themed primary, with a secondary woven in.
  const useSecondary = (((dq - dr) % 3) + 3) % 3 === 0;
  const terrain = useSecondary ? SECONDARY[theme] : PRIMARY[theme];
  const cost = (Math.abs(dq * 3 + dr * 7 + 11) % 3) + 1; // 1..3
  return { terrain, cost };
}

export interface TileStep {
  theme: TileTheme;
  /** Index into TILE_NEIGHBOR_OFFSETS for the NEXT tile (omit on the last). */
  dir?: number;
}

/** Build a map by placing tiles edge-to-edge along a path of steps. */
export function buildTileMap(id: string, name: string, path: TileStep[]): GameMap {
  const cells = localCells();
  const hexByKey = new Map<string, Hex>();
  const starts: Array<{ slot: number; coord: Axial }> = [];
  const finishes: Array<{ slot: number; coord: Axial }> = [];

  let center: Axial = { q: 0, r: 0 };
  for (const step of path) {
    for (const c of cells) {
      const q = center.q + c.q;
      const r = center.r + c.r;
      const k = `${q},${r}`;
      if (hexByKey.has(k)) continue; // shared-edge dedupe (shouldn't happen with these offsets)
      const spec = cellSpec(step.theme, c.q, c.r);
      const hex: Hex = { q, r, terrain: spec.terrain, cost: spec.cost };
      if (spec.slot !== undefined) hex.slot = spec.slot;
      hexByKey.set(k, hex);
      if (spec.terrain === 'start') starts.push({ slot: spec.slot!, coord: { q, r } });
      if (spec.terrain === 'finish') finishes.push({ slot: spec.slot!, coord: { q, r } });
    }
    if (step.dir !== undefined) {
      const off = TILE_NEIGHBOR_OFFSETS[step.dir];
      center = { q: center.q + off.q, r: center.r + off.r };
    }
  }

  starts.sort((a, b) => a.slot - b.slot);
  finishes.sort((a, b) => a.slot - b.slot);
  return {
    id,
    name,
    hexes: [...hexByKey.values()],
    startHexes: starts.map((s) => s.coord),
    finishHexes: finishes.map((f) => f.coord),
  };
}

export { key };
