import { describe, it, expect } from 'vitest';
import { CLASSIC_MAP } from '../src/maps/index.js';
import { neighbors, key, isAdjacent, axialToPixel } from '../src/hex.js';
import type { MoveSymbol, Terrain } from '../src/types.js';

function blockadeSymbolForTerrain(terrain: Terrain): MoveSymbol | undefined {
  if (terrain === 'green') return 'machete';
  if (terrain === 'blue') return 'paddle';
  if (terrain === 'yellow') return 'coin';
  return undefined;
}

describe('classic map', () => {
  it('has 4 start hexes and 3 El Dorado entrances', () => {
    expect(CLASSIC_MAP.startHexes).toHaveLength(4);
    expect(CLASSIC_MAP.finishHexes).toHaveLength(3);
  });

  it('adds one seam blockade between each pair of continent tiles', () => {
    expect(CLASSIC_MAP.blockades).toHaveLength(4);
    expect(CLASSIC_MAP.blockades.map((b) => b.terrain)).toEqual(['green', 'blue', 'yellow', 'rubble']);
    const hexKeys = new Set(CLASSIC_MAP.hexes.map(key));
    for (const blockade of CLASSIC_MAP.blockades) {
      expect(hexKeys.has(key(blockade.a))).toBe(true);
      expect(hexKeys.has(key(blockade.b))).toBe(true);
      expect(isAdjacent(blockade.a, blockade.b)).toBe(true);
      expect(blockade.edges.length).toBeGreaterThan(1);
      expect(['green', 'blue', 'yellow', 'rubble']).toContain(blockade.terrain);
      for (const edge of blockade.edges) {
        expect(hexKeys.has(key(edge.a))).toBe(true);
        expect(hexKeys.has(key(edge.b))).toBe(true);
        expect(isAdjacent(edge.a, edge.b)).toBe(true);
      }
      expect(blockade.symbol).toBe(blockadeSymbolForTerrain(blockade.terrain));
      expect(blockade.cost).toBeGreaterThan(0);
    }
  });

  it('is fully connected (BFS reaches every passable hex from a start)', () => {
    const passable = CLASSIC_MAP.hexes.filter((h) => h.terrain !== 'mountain');
    const byKey = new Map(passable.map((h) => [key(h), h]));
    const start = CLASSIC_MAP.startHexes[0];
    const seen = new Set<string>([key(start)]);
    const queue = [start];
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
  });

  it('finish hexes are reachable from start', () => {
    const byKey = new Map(
      CLASSIC_MAP.hexes
        .filter((h) => h.terrain !== 'mountain')
        .map((h) => [key(h), h]),
    );
    const start = CLASSIC_MAP.startHexes[0];
    const seen = new Set<string>([key(start)]);
    const queue = [start];
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
    for (const f of CLASSIC_MAP.finishHexes) {
      expect(seen.has(key(f))).toBe(true);
    }
  });
});

describe('El Dorado city', () => {
  const city = CLASSIC_MAP.hexes.filter((h) => h.terrain === 'eldorado');
  const gate = CLASSIC_MAP.finishHexes[1] ?? CLASSIC_MAP.finishHexes[0];
  const start = CLASSIC_MAP.startHexes[0];

  it('adds a compact three-hex golden city beyond the entrances', () => {
    expect(city).toHaveLength(3);
  });

  it('city cells are not finish cells', () => {
    const finishKeys = new Set(CLASSIC_MAP.finishHexes.map(key));
    for (const c of city) expect(finishKeys.has(key(c))).toBe(false);
  });

  it('is one connected blob attached to the entrances', () => {
    const cityKeys = new Set(city.map(key));
    const entranceKeys = new Set(CLASSIC_MAP.finishHexes.map(key));
    const seen = new Set<string>([key(city[0])]);
    const queue = [city[0]];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of neighbors(cur)) {
        const k = key(n);
        if (cityKeys.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(city.length);
    expect(city.some((c) => neighbors(c).some((n) => entranceKeys.has(key(n))))).toBe(true);
  });

  it('fans outward from the gate apex, never wrapping back toward start', () => {
    const g = axialToPixel(gate, 1);
    const s = axialToPixel(start, 1);
    let dx = g.x - s.x;
    let dy = g.y - s.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    for (const c of city) {
      const p = axialToPixel(c, 1);
      const forward = (p.x - g.x) * dx + (p.y - g.y) * dy;
      expect(forward).toBeGreaterThanOrEqual(-0.6);
    }
  });
});
