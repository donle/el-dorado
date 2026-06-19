import { describe, it, expect } from 'vitest';
import { parsePlate, localFromRowCol, type PlateDef } from '../src/maps/plate.js';

const FULL: PlateDef = {
  id: 'p',
  theme: 'jungle',
  rows: [
    'g2 b1 g1 g3',
    'g1 g2 b2 g1 g2',
    'b1 g2 g1 g2 b3 g1',
    'S1 g1 MM g3 b2 g1 g2',
    'S2 b2 C2 g2 g1 b1',
    'S3 g1 b3 g2 g1',
    'S4 g2 g1 g3',
  ],
};

describe('plate parser', () => {
  it('maps row/col to local axial (centre 0,0)', () => {
    expect(localFromRowCol(0, 0)).toEqual({ q: 0, r: -3 }); // top row leftmost
    expect(localFromRowCol(3, 0)).toEqual({ q: -3, r: 0 }); // middle row leftmost
    expect(localFromRowCol(3, 6)).toEqual({ q: 3, r: 0 }); // middle row rightmost
    expect(localFromRowCol(6, 0)).toEqual({ q: -3, r: 3 }); // bottom row leftmost
  });

  it('parses a full plate into 37 cells', () => {
    const p = parsePlate(FULL);
    expect(p.cells).toHaveLength(37);
  });

  it('reads terrain, cost, mountain, specials and start slots', () => {
    const p = parsePlate(FULL);
    const at = (q: number, r: number) => p.cells.find((c) => c.local.q === q && c.local.r === r)!;
    expect(at(0, -3)).toMatchObject({ terrain: 'green', cost: 2 }); // g2 top-left
    expect(at(-3, 0)).toMatchObject({ terrain: 'start', cost: 0, slot: 1 }); // S1
    expect(at(-3, 3)).toMatchObject({ terrain: 'start', cost: 0, slot: 4 }); // S4 bottom-left
    const mountain = p.cells.find((c) => c.terrain === 'mountain')!;
    expect(mountain.cost).toBe(0);
    const camp = p.cells.find((c) => c.terrain === 'basecamp')!;
    expect(camp.cost).toBe(2);
  });

  it('rejects wrong row count', () => {
    expect(() => parsePlate({ id: 'x', theme: 't', rows: ['g1 g1 g1 g1'] })).toThrow(/7 行/);
  });

  it('rejects wrong row width', () => {
    const bad = { ...FULL, rows: [...FULL.rows] };
    bad.rows[0] = 'g1 g1 g1'; // 3 instead of 4
    expect(() => parsePlate(bad)).toThrow(/第 1 行/);
  });

  it('rejects unknown token', () => {
    const bad = { ...FULL, rows: [...FULL.rows] };
    bad.rows[0] = 'g1 zz g1 g3';
    expect(() => parsePlate(bad)).toThrow(/未知地图标记/);
  });
});
