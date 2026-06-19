import { describe, it, expect } from 'vitest';
import { assembleMap, placePlates, type MapDef } from '../src/maps/assemble.js';
import type { PlateDef } from '../src/maps/plate.js';
import { key, neighbors } from '../src/hex.js';

// Two solid plates with no specials, easy to reason about.
function solid(id: string): PlateDef {
  return {
    id,
    theme: 'jungle',
    rows: [
      'g1 g1 g1 g1',
      'g1 g1 g1 g1 g1',
      'g1 g1 g1 g1 g1 g1',
      'g1 g1 g1 g1 g1 g1 g1',
      'g1 g1 g1 g1 g1 g1',
      'g1 g1 g1 g1 g1',
      'g1 g1 g1 g1',
    ],
  };
}

const LIB: Record<string, PlateDef> = { a: solid('a'), b: solid('b') };

const TWO: MapDef = {
  id: 'two',
  name: '两块',
  plates: [
    { id: 'p0', ref: 'a' },
    { id: 'p1', ref: 'b' },
  ],
  connections: [{ from: 'p0', edge: 'right-up', to: 'p1' }],
};

describe('assemble: placement + materialize', () => {
  it('places the root at origin and the neighbour across the edge', () => {
    const placed = placePlates(TWO, LIB);
    expect(placed.find((p) => p.instanceId === 'p0')!.center).toEqual({ q: 0, r: 0 });
    expect(placed.find((p) => p.instanceId === 'p1')!.center).toEqual({ q: 7, r: -3 });
  });

  it('two edge-joined plates do not overlap (74 cells)', () => {
    const m = assembleMap(TWO, LIB);
    expect(m.hexes).toHaveLength(74);
    expect(new Set(m.hexes.map(key)).size).toBe(74);
  });

  it('collects start hexes ordered by slot', () => {
    const startPlate: PlateDef = {
      id: 's',
      theme: 'start',
      rows: [
        'g1 g1 g1 g1',
        'g1 g1 g1 g1 g1',
        'g1 g1 g1 g1 g1 g1',
        'S1 g1 g1 g1 g1 g1 g1',
        'S2 g1 g1 g1 g1 g1',
        'S3 g1 g1 g1 g1',
        'S4 g1 g1 g1',
      ],
    };
    const m = assembleMap(
      { id: 'one', name: '一块', plates: [{ id: 'p', ref: 's' }], connections: [] },
      { s: startPlate },
    );
    expect(m.startHexes).toHaveLength(4);
    // S1..S4 sit on the q = -3 column, r = 0..3
    expect(m.startHexes).toEqual([
      { q: -3, r: 0 },
      { q: -3, r: 1 },
      { q: -3, r: 2 },
      { q: -3, r: 3 },
    ]);
  });

  it('rejects an unknown plate ref', () => {
    expect(() =>
      assembleMap({ id: 'x', name: 'x', plates: [{ id: 'p', ref: 'nope' }], connections: [] }, LIB),
    ).toThrow(/未知板块/);
  });

  it('rejects a disconnected graph', () => {
    const def: MapDef = {
      id: 'd',
      name: 'd',
      plates: [
        { id: 'p0', ref: 'a' },
        { id: 'p1', ref: 'b' },
      ],
      connections: [],
    };
    expect(() => assembleMap(def, LIB)).toThrow(/未连通/);
  });

  it('keeps neighbours adjacent across the seam', () => {
    const m = assembleMap(TWO, LIB);
    const keys = new Set(m.hexes.map(key));
    // every hex has at least one neighbour in the map (single connected blob)
    const seen = new Set<string>([key(m.hexes[0])]);
    const queue = [m.hexes[0]];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of neighbors(cur)) {
        const k = key(n);
        if (keys.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    expect(seen.size).toBe(m.hexes.length);
  });
});
