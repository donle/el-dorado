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

  it('buildTileMap generates a claimable seam blockade for a tile connection', () => {
    const m = buildTileMap('t', 'two', [{ theme: 'jungle', connect: 'right-up' }, { theme: 'river' }]);
    expect(m.blockades).toHaveLength(1);
    expect(m.blockades[0].terrain).toBe('green');
    expect(m.blockades[0].edges.length).toBeGreaterThan(1);
    expect(neighbors(m.blockades[0].a).some((n) => key(n) === key(m.blockades[0].b))).toBe(true);
    expect(m.hexes.some((h) => key(h) === key(m.blockades[0].a))).toBe(true);
    expect(m.hexes.some((h) => key(h) === key(m.blockades[0].b))).toBe(true);
  });

  it('classic map: 5 tiles + El Dorado, 4 start, 3 entrance hexes', () => {
    expect(CLASSIC_MAP.hexes.length).toBeGreaterThanOrEqual(186); // 185 tile cells + gate (+arms)
    expect(CLASSIC_MAP.blockades).toHaveLength(4);
    expect(CLASSIC_MAP.startHexes).toHaveLength(4);
    expect(CLASSIC_MAP.finishHexes).toHaveLength(3);

    // The three El Dorado entrances demand gold (coin) power and touch the city.
    const entrances = CLASSIC_MAP.hexes.filter((h) => h.terrain === 'finish');
    expect(entrances).toHaveLength(3);
    const cityKeys = new Set(CLASSIC_MAP.hexes.filter((h) => h.terrain === 'eldorado').map(key));
    for (const entrance of entrances) {
      expect(entrance.reqSymbol).toBe('coin');
      expect(entrance.cost).toBeGreaterThan(0);
      expect(neighbors(entrance).some((n) => cityKeys.has(key(n)))).toBe(true);
    }

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
