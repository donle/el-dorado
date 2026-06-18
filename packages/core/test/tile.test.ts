import { describe, it, expect } from 'vitest';
import { buildTileMap, TILE_NEIGHBOR_OFFSETS } from '../src/maps/tile.js';
import { CLASSIC_MAP } from '../src/maps/index.js';
import { neighbors, key } from '../src/hex.js';

describe('tile composition', () => {
  it('a single tile is a side-4 hexagon of 37 cells', () => {
    const m = buildTileMap('t', 'one', [{ theme: 'jungle' }]);
    expect(m.hexes).toHaveLength(37);
  });

  it('two edge-joined tiles do not overlap (74 cells)', () => {
    const m = buildTileMap('t', 'two', [{ theme: 'jungle', dir: 0 }, { theme: 'river' }]);
    expect(m.hexes).toHaveLength(74);
    const keys = new Set(m.hexes.map(key));
    expect(keys.size).toBe(74);
  });

  it('exposes 6 neighbour offsets', () => {
    expect(TILE_NEIGHBOR_OFFSETS).toHaveLength(6);
  });

  it('classic map: 5 tiles = 185 cells, 4 start, 3 finish, fully connected', () => {
    expect(CLASSIC_MAP.hexes).toHaveLength(185);
    expect(CLASSIC_MAP.startHexes).toHaveLength(4);
    expect(CLASSIC_MAP.finishHexes).toHaveLength(3);

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
