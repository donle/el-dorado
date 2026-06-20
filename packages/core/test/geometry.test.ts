import { describe, it, expect } from 'vitest';
import {
  TILE_EDGES,
  TILE_NEIGHBOR_OFFSETS,
  EDGE_OFFSET,
  OPPOSITE_EDGE,
  neighborCenter,
  localCells,
  type TileEdge,
} from '../src/maps/geometry.js';

describe('hex geometry', () => {
  it('exposes 6 named edges with offsets', () => {
    expect(TILE_EDGES).toHaveLength(6);
    expect(TILE_NEIGHBOR_OFFSETS).toHaveLength(6);
    expect(Object.keys(EDGE_OFFSET)).toHaveLength(6);
  });

  it('opposite edges have opposite offsets', () => {
    for (const edge of TILE_EDGES) {
      const a = EDGE_OFFSET[edge];
      const b = EDGE_OFFSET[OPPOSITE_EDGE[edge as TileEdge]];
      expect({ q: a.q + b.q, r: a.r + b.r }, edge).toEqual({ q: 0, r: 0 });
    }
  });

  it('neighborCenter applies the edge offset', () => {
    expect(neighborCenter({ q: 0, r: 0 }, 'up')).toEqual({ q: 4, r: -7 });
  });

  it('localCells is a 37-cell hexagon', () => {
    const cells = localCells();
    expect(cells).toHaveLength(37);
    for (const c of cells) {
      expect(Math.abs(c.q)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.r)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.q + c.r)).toBeLessThanOrEqual(3);
    }
  });
});
