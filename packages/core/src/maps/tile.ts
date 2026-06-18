/**
 * Tile-based map composition — faithful to the physical game.
 *
 * - Smallest unit: one hex cell.
 * - One "continent tile" is a regular hexagon of hexes with side length 4 =
 *   37 cells (all cells within cube-distance 3 of the tile centre).
 * - Tiles connect edge-to-edge to form the route. Because a hexagon's edge is
 *   a zig-zag of cells, the seam between two tiles is staggered. A regular
 *   hexagon has exactly 6 edges, so there are 6 ways to attach a neighbour —
 *   captured by the {@link TileEdge} interface below. The four diagonal edges
 *   come as left/right-staggered pairs (right-up vs right-down, left-up vs
 *   left-down); the remaining two are the straight up / down seams.
 *
 * Two side-4 hexagons placed at an edge offset share a 7-cell border with
 * zero overlap (verified).
 */
import type { GameMap, Hex, Terrain, Axial } from '../types.js';
import { key, neighbors, distance } from '../hex.js';

export const TILE_RADIUS = 3; // side length 4 → 37 cells

// --- Connection abstraction ----------------------------------------------

/**
 * The six edges along which one tile attaches to a neighbour. The diagonal
 * edges encode the zig-zag stagger directly in their name:
 *   right-up / right-down  → rightward seam, staggered up or down
 *   left-up  / left-down   → leftward seam, staggered up or down
 *   up / down              → straight vertical seam
 */
export type TileEdge =
  | 'right-up'
  | 'right-down'
  | 'left-up'
  | 'left-down'
  | 'up'
  | 'down';

/** Canonical edge order (matches the 6 hexagonal neighbour directions). */
export const TILE_EDGES: readonly TileEdge[] = [
  'right-up',
  'right-down',
  'down',
  'left-down',
  'left-up',
  'up',
];

/** Centre-to-centre axial offset to the neighbour across each edge. */
export const EDGE_OFFSET: Record<TileEdge, Axial> = {
  'right-up': { q: 7, r: -3 },
  'right-down': { q: 3, r: 4 },
  down: { q: -4, r: 7 },
  'left-down': { q: -7, r: 3 },
  'left-up': { q: -3, r: -4 },
  up: { q: 4, r: -7 },
};

/** The edge of the neighbour that faces back (B attaches to A here). */
export const OPPOSITE_EDGE: Record<TileEdge, TileEdge> = {
  'right-up': 'left-down',
  'left-down': 'right-up',
  'right-down': 'left-up',
  'left-up': 'right-down',
  up: 'down',
  down: 'up',
};

/** Low-level offsets in canonical order — for callers that index numerically. */
export const TILE_NEIGHBOR_OFFSETS: Axial[] = TILE_EDGES.map((e) => EDGE_OFFSET[e]);

/** The centre of the tile reached by crossing `edge` from `center`. */
export function neighborCenter(center: Axial, edge: TileEdge): Axial {
  const o = EDGE_OFFSET[edge];
  return { q: center.q + o.q, r: center.r + o.r };
}

// --- Tile content ----------------------------------------------------------

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
  // The end tile is ordinary terrain; El Dorado is a separate gate tile
  // attached at one of its corners (see attachEldorado).
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

// --- Assembly --------------------------------------------------------------

/** A tile placed at an explicit centre — the unit of a general layout. */
export interface PlacedTile {
  theme: TileTheme;
  center: Axial;
}

/** One tile in a linear chain; `connect` is the edge toward the NEXT tile. */
export interface TileSpec {
  theme: TileTheme;
  connect?: TileEdge;
}

/**
 * Build a map from tiles placed at explicit centres. Fully general — supports
 * branching / non-linear layouts. Overlapping cells are de-duplicated.
 */
export function assembleTiles(id: string, name: string, placed: PlacedTile[]): GameMap {
  const cells = localCells();
  const hexByKey = new Map<string, Hex>();
  const starts: Array<{ slot: number; coord: Axial }> = [];
  const finishes: Array<{ slot: number; coord: Axial }> = [];

  for (const tile of placed) {
    for (const c of cells) {
      const q = tile.center.q + c.q;
      const r = tile.center.r + c.r;
      const k = `${q},${r}`;
      if (hexByKey.has(k)) continue; // shared-edge dedupe
      const spec = cellSpec(tile.theme, c.q, c.r);
      const hex: Hex = { q, r, terrain: spec.terrain, cost: spec.cost };
      if (spec.slot !== undefined) hex.slot = spec.slot;
      hexByKey.set(k, hex);
      if (spec.terrain === 'start') starts.push({ slot: spec.slot!, coord: { q, r } });
      if (spec.terrain === 'finish') finishes.push({ slot: spec.slot!, coord: { q, r } });
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

/** Power/symbol required to step onto the El Dorado gate. */
export const ELDORADO_COST = 2;
export const ELDORADO_SYMBOL = 'coin' as const;

/**
 * Attach El Dorado as a separate, irregular gate hex nestled into a forward
 * corner of the end tile: a single golden gate cell embraced on three sides
 * (the tile corner plus two flanking "arm" cells). Stepping onto it requires
 * gold (coin) power — it is not a free finish. Returns a new map with it added.
 */
function attachEldorado(map: GameMap, placed: PlacedTile[]): GameMap {
  const end = placed.find((t) => t.theme === 'end');
  if (!end) return map;
  const start = placed[0]?.center ?? { q: 0, r: 0 };
  const occupied = new Set(map.hexes.map(key));
  const adj = (a: Axial, b: Axial) => neighbors(a).some((n) => n.q === b.q && n.r === b.r);

  // Forward-most boundary cell of the end tile (cube-ring 3, farthest from start).
  const boundary = localCells()
    .filter((c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) === TILE_RADIUS)
    .map((c) => ({ q: end.center.q + c.q, r: end.center.r + c.r }));
  const byStartDist = (cells: Axial[]) =>
    cells.slice().sort((a, b) => distance(b, start) - distance(a, start) || key(a).localeCompare(key(b)));
  const k = byStartDist(boundary)[0];

  // Exterior cells just beyond K. The gate sits at the one most flanked by its
  // siblings, so the corner wraps it on three sides.
  const ext = neighbors(k).filter((n) => !occupied.has(key(n)));
  if (!ext.length) return map;
  const flankCount = (c: Axial) => ext.filter((o) => o !== c && adj(o, c)).length;
  const gate = ext
    .slice()
    .sort((a, b) => flankCount(b) - flankCount(a) || distance(b, start) - distance(a, start))[0];
  const arms = ext.filter((o) => o !== gate && adj(o, gate)).slice(0, 2);

  const hexes = map.hexes.slice();
  // Two grassy "arm" cells embrace the gate (kept off the finish list).
  for (const a of arms) {
    if (occupied.has(key(a))) continue;
    occupied.add(key(a));
    hexes.push({ q: a.q, r: a.r, terrain: 'yellow', cost: 1 });
  }
  hexes.push({ q: gate.q, r: gate.r, terrain: 'finish', cost: ELDORADO_COST, reqSymbol: ELDORADO_SYMBOL, slot: 1 });
  return { ...map, hexes, finishHexes: [{ q: gate.q, r: gate.r }] };
}

/**
 * Convenience builder for the common case: a chain of tiles, each attached to
 * the next along a named {@link TileEdge}. Resolves the chain to explicit
 * centres and delegates to {@link assembleTiles}, then attaches the El Dorado
 * gate if the chain ends with an `end` tile.
 */
export function buildTileMap(id: string, name: string, chain: TileSpec[]): GameMap {
  const placed: PlacedTile[] = [];
  let center: Axial = { q: 0, r: 0 };
  for (const spec of chain) {
    placed.push({ theme: spec.theme, center });
    if (spec.connect) center = neighborCenter(center, spec.connect);
  }
  const map = assembleTiles(id, name, placed);
  return attachEldorado(map, placed);
}

export { key };
