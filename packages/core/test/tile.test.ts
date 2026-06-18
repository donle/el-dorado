import { describe, it, expect } from 'vitest';
import {
  buildTileMap,
  assembleTiles,
  neighborCenter,
  TILE_EDGES,
  TILE_NEIGHBOR_OFFSETS,
  EDGE_OFFSET,
  OPPOSITE_EDGE,
  type TileEdge,
} from '../src/maps/tile.js';
import { CLASSIC_MAP } from '../src/maps/index.js';
import { neighbors, key } from '../src/hex.js';

describe('tile composition', () => {
  it('a single tile is a side-4 hexagon of 37 cells', () => {
    const m = buildTileMap('t', 'one', [{ theme: 'jungle' }]);
    expect(m.hexes).toHaveLength(37);
  });

  it('two edge-joined tiles do not overlap (74 cells) for every edge', () => {
    for (const edge of TILE_EDGES) {
      const m = buildTileMap('t', 'two', [{ theme: 'jungle', connect: edge }, { theme: 'river' }]);
      expect(m.hexes, edge).toHaveLength(74);
      expect(new Set(m.hexes.map(key)).size, edge).toBe(74);
    }
  });

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

  it('neighborCenter + assembleTiles compose two tiles edge-to-edge', () => {
    const c0 = { q: 0, r: 0 };
    const c1 = neighborCenter(c0, 'right-up');
    const m = assembleTiles('t', 'two', [
      { theme: 'jungle', center: c0 },
      { theme: 'river', center: c1 },
    ]);
    expect(m.hexes).toHaveLength(74);
  });

  it('classic map: 5 tiles + El Dorado gate, 4 start, 1 fully-connected finish', () => {
    expect(CLASSIC_MAP.hexes.length).toBeGreaterThanOrEqual(186); // 185 tile cells + gate (+arms)
    expect(CLASSIC_MAP.startHexes).toHaveLength(4);
    expect(CLASSIC_MAP.finishHexes).toHaveLength(1);

    // The El Dorado gate demands gold (coin) power and is wrapped on 3 sides.
    const gate = CLASSIC_MAP.hexes.find((h) => h.terrain === 'finish')!;
    expect(gate.reqSymbol).toBe('coin');
    expect(gate.cost).toBeGreaterThan(0);
    const tileKeys = new Set(CLASSIC_MAP.hexes.filter((h) => h.terrain !== 'finish').map(key));
    const wrap = neighbors(gate).filter((n) => tileKeys.has(key(n))).length;
    expect(wrap).toBeGreaterThanOrEqual(3);

    const passable = CLASSIC_MAP.hexes.filter((h) => h.terrain !== 'mountain');
    const byKey = new Map(passable.map((h) => [key(h), h]));
    const seen = new Set([key(CLASSIC_MAP.startHexes[0])]);
    const queue = [CLASSIC_MAP.startHexes[0]];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of neighbors(cur)) {
        const k = key(n);
        if (byKey.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(passable.length);
    for (const f of CLASSIC_MAP.finishHexes) expect(seen.has(key(f))).toBe(true);
  });
});
