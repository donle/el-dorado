import { describe, it, expect } from 'vitest';
import { CLASSIC_MAP } from '../src/maps/index.js';
import { neighbors, key } from '../src/hex.js';

describe('classic map', () => {
  it('has 4 start hexes and at least 2 finish hexes', () => {
    expect(CLASSIC_MAP.startHexes).toHaveLength(4);
    expect(CLASSIC_MAP.finishHexes.length).toBeGreaterThanOrEqual(2);
  });

  it('is fully connected (BFS reaches every non-mountain hex from a start)', () => {
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
      CLASSIC_MAP.hexes.filter((h) => h.terrain !== 'mountain').map((h) => [key(h), h]),
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
