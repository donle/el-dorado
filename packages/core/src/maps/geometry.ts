/**
 * 六边形板块几何：side-4 正六边形(37 格)与 6 条边的拼接偏移。
 * 从旧 tile.ts 抽出——只保留几何，不含任何程序化地形生成。
 */
import type { Axial } from '../types.js';

export const TILE_RADIUS = 3; // side length 4 → 37 cells

export type TileEdge =
  | 'right-up'
  | 'right-down'
  | 'left-up'
  | 'left-down'
  | 'up'
  | 'down';

export type TileEdgeAlignment = 'default' | 'alternate';

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

/** Alternate full-edge alignment, shifted by one zigzag phase along the seam. */
export const ALTERNATE_EDGE_OFFSET: Record<TileEdge, Axial> = {
  'right-up': { q: 7, r: -4 },
  'right-down': { q: 4, r: 3 },
  down: { q: -3, r: 7 },
  'left-down': { q: -7, r: 4 },
  'left-up': { q: -4, r: -3 },
  up: { q: 3, r: -7 },
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

/** Low-level offsets in canonical order. */
export const TILE_NEIGHBOR_OFFSETS: Axial[] = TILE_EDGES.map((e) => EDGE_OFFSET[e]);

export function edgeOffset(edge: TileEdge, alignment: TileEdgeAlignment = 'default'): Axial {
  if (alignment === 'default') return EDGE_OFFSET[edge];
  if (alignment === 'alternate') return ALTERNATE_EDGE_OFFSET[edge];
  throw new Error(`未知板块边缘错位：${alignment}`);
}

/** The centre of the tile reached by crossing `edge` from `center`. */
export function neighborCenter(center: Axial, edge: TileEdge, alignment: TileEdgeAlignment = 'default'): Axial {
  const o = edgeOffset(edge, alignment);
  return { q: center.q + o.q, r: center.r + o.r };
}

/** Local cells of a tile (centre at 0,0): 37 axial coords. */
export function localCells(): Axial[] {
  const out: Axial[] = [];
  for (let dq = -TILE_RADIUS; dq <= TILE_RADIUS; dq++) {
    const lo = Math.max(-TILE_RADIUS, -dq - TILE_RADIUS);
    const hi = Math.min(TILE_RADIUS, -dq + TILE_RADIUS);
    for (let dr = lo; dr <= hi; dr++) out.push({ q: dq, r: dr });
  }
  return out;
}
