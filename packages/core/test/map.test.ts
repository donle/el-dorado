import { describe, it, expect } from 'vitest';
import { CLASSIC_MAP, MAP_OPTIONS, OFFICIAL_MAPS, parsePlate, type MapDef, type PlateDef } from '../src/maps/index.js';
import { placePlates } from '../src/maps/assemble.js';
import { neighbors, key, isAdjacent, axialToPixel } from '../src/hex.js';
import type { MoveSymbol, Terrain } from '../src/types.js';
import officialPlates from '../src/maps/data/official-plates.json' with { type: 'json' };
import officialRouteDefs from '../src/maps/data/official-routes.map.json' with { type: 'json' };

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
    const entrances = CLASSIC_MAP.finishHexes.map((f) => CLASSIC_MAP.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => h.terrain)).toEqual(['blue', 'blue', 'blue']);
    for (const entrance of entrances) {
      expect(entrance.finishEntrance).toBe(true);
      expect(entrance.cost).toBe(1);
      expect(entrance.reqSymbol).toBeUndefined();
    }
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

describe('official route maps', () => {
  function officialRoute(id: string): MapDef {
    const route = (officialRouteDefs as MapDef[]).find((entry) => entry.id === id);
    if (!route) throw new Error(`missing official route ${id}`);
    return route;
  }

  function plateContacts(route: MapDef): Array<{ pair: string; overlap: number; touch: number }> {
    const placed = placePlates(route, officialPlates as Record<string, PlateDef>);
    const contacts: Array<{ pair: string; overlap: number; touch: number }> = [];
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        let overlap = 0;
        let touch = 0;
        const bKeys = new Set(b.plate.cells.map((cell) => key({ q: b.center.q + cell.local.q, r: b.center.r + cell.local.r })));
        for (const ca of a.plate.cells) {
          const wa = { q: a.center.q + ca.local.q, r: a.center.r + ca.local.r };
          if (bKeys.has(key(wa))) overlap++;
          for (const cb of b.plate.cells) {
            const wb = { q: b.center.q + cb.local.q, r: b.center.r + cb.local.r };
            if (isAdjacent(wa, wb)) touch++;
          }
        }
        if (overlap || touch) contacts.push({ pair: `${a.instanceId}-${b.instanceId}`, overlap, touch });
      }
    }
    return contacts;
  }

  it('keeps the official plate terrain mixes, including 16-space strips', () => {
    const expected: Record<string, Partial<Record<Terrain, number>>> = {
      'official-a': { green: 22, blue: 3, yellow: 5, mountain: 2, basecamp: 1, start: 4 },
      'official-b': { green: 23, blue: 4, yellow: 4, mountain: 1, basecamp: 1, start: 4 },
      'official-c': { green: 6, blue: 12, yellow: 9, mountain: 1, rubble: 9 },
      'official-d': { green: 19, blue: 11, yellow: 3, mountain: 4 },
      'official-e': { green: 15, blue: 4, yellow: 4, mountain: 5, basecamp: 1, rubble: 8 },
      'official-f': { green: 12, blue: 8, yellow: 3, mountain: 4, basecamp: 2, rubble: 8 },
      'official-g': { green: 17, yellow: 13, mountain: 4, basecamp: 1, rubble: 2 },
      'official-h': { green: 12, blue: 10, yellow: 14, mountain: 1 },
      'official-i': { green: 17, blue: 6, yellow: 6, mountain: 6, basecamp: 1, rubble: 1 },
      'official-j': { green: 6, blue: 9, yellow: 10, mountain: 2, basecamp: 1, rubble: 9 },
      'official-k': { green: 33, blue: 1, yellow: 1, basecamp: 2 },
      'official-l': { green: 26, blue: 3, yellow: 2, mountain: 3, basecamp: 3 },
      'official-m': { green: 18, blue: 4, yellow: 2, mountain: 9, basecamp: 1, rubble: 3 },
      'official-n': { green: 18, blue: 9, yellow: 10 },
      'official-o': { green: 3, blue: 2, yellow: 4, mountain: 3, rubble: 4 },
      'official-q': { green: 7, blue: 3, yellow: 3, rubble: 3 },
      'official-r': { green: 6, yellow: 6, mountain: 3, basecamp: 1 },
    };

    for (const [id, want] of Object.entries(expected)) {
      const plate = parsePlate((officialPlates as Record<string, PlateDef>)[id]);
      const got: Partial<Record<Terrain, number>> = {};
      for (const cell of plate.cells) got[cell.terrain] = (got[cell.terrain] ?? 0) + 1;
      expect(got).toEqual(want);
    }
  });

  it('keeps official strip plates as 5-6-5 half-offset pieces', () => {
    for (const id of ['official-o', 'official-q', 'official-r']) {
      const plate = parsePlate((officialPlates as Record<string, PlateDef>)[id]);
      const rows = new Map<number, number[]>();
      for (const cell of plate.cells) {
        const row = rows.get(cell.local.r) ?? [];
        row.push(cell.local.q);
        rows.set(cell.local.r, row);
      }
      expect(Object.fromEntries([...rows].map(([r, qs]) => [r, qs.sort((a, b) => a - b)]))).toEqual({
        '-1': [-1, 0, 1, 2, 3],
        '0': [-2, -1, 0, 1, 2, 3],
        '1': [-2, -1, 0, 1, 2],
      });
    }
  });

  it('registers the playable routes from the assembly guide', () => {
    expect(MAP_OPTIONS.map((m) => m.id)).toEqual([
      'classic',
      'official-first',
      'official-hills-of-gold',
      'official-home-stretch',
      'official-winding-paths',
      'official-serpentine',
      'official-witchs-cauldron',
      'official-swamplands',
    ]);
  });

  it('rotates the first official route so the starting edge matches the setup sheet', () => {
    expect(OFFICIAL_MAPS['official-first'].startHexes).toEqual([
      { q: -3, r: 0 },
      { q: -2, r: -1 },
      { q: -1, r: -2 },
      { q: 0, r: -3 },
    ]);
  });

  it('keeps the setup-sheet rotations for hills, winding paths, serpentine, and witchs cauldron', () => {
    const rotations = (route: MapDef) => Object.fromEntries(route.plates.map((plate) => [plate.id, plate.rotation ?? 0]));
    expect(rotations(officialRoute('official-hills-of-gold'))).toEqual({
      b: 1,
      c: 0,
      g: 0,
      k: 1,
      j: 1,
      n: 1,
    });
    expect(rotations(officialRoute('official-winding-paths'))).toEqual({
      b: 1,
      i: 3,
      f: 3,
      c: 0,
      g: 1,
      n: 4,
    });
    expect(rotations(officialRoute('official-serpentine'))).toEqual({
      a: 1,
      c: 4,
      e: 1,
      g: 3,
      j: 3,
      m: 5,
    });
    expect(rotations(officialRoute('official-witchs-cauldron'))).toEqual({
      a: 0,
      l: 5,
      g: 4,
      d: 4,
      m: 0,
      i: 5,
    });
  });

  it('keeps hills of gold starts on the outside edge and uses green El Dorado entrances', () => {
    const map = OFFICIAL_MAPS['official-hills-of-gold'];
    expect(map.startHexes).toEqual([
      { q: -3, r: 3 },
      { q: -3, r: 2 },
      { q: -3, r: 1 },
      { q: -3, r: 0 },
    ]);
    expect(map.finishHexes).toEqual([
      { q: 29, r: -17 },
      { q: 29, r: -16 },
      { q: 28, r: -15 },
    ]);
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'green', cost: 1 },
      { terrain: 'green', cost: 1 },
      { terrain: 'green', cost: 1 },
    ]);
  });

  it('places winding paths in the upright orientation implied by the setup sheet', () => {
    const route = officialRoute('official-winding-paths');
    const connections = route.connections.map(({ from, edge, alignment, to }) => ({ from, edge, alignment, to }));
    expect(connections).toContainEqual({
      from: 'b',
      edge: 'up',
      alignment: undefined,
      to: 'i',
    });
    expect(connections).toContainEqual({
      from: 'f',
      edge: 'right-down',
      alignment: 'alternate',
      to: 'g',
    });
    expect(connections).toContainEqual({
      from: 'c',
      edge: 'down',
      alignment: undefined,
      to: 'g',
    });
    expect(connections.some((conn) => conn.from === 'f' && conn.to === 'c')).toBe(false);
  });

  it('keeps winding paths starts on the outside edge and uses blue El Dorado entrances', () => {
    expect(officialRoute('official-winding-paths').plates.find((plate) => plate.id === 'n')?.finishAnchor).toEqual({
      q: 3,
      r: -3,
    });
    const map = OFFICIAL_MAPS['official-winding-paths'];
    expect(map.startHexes).toEqual([
      { q: -3, r: 3 },
      { q: -3, r: 2 },
      { q: -3, r: 1 },
      { q: -3, r: 0 },
    ]);
    expect(map.finishHexes).toEqual([
      { q: 30, r: -20 },
      { q: 30, r: -21 },
      { q: 29, r: -21 },
    ]);
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
    ]);
  });

  it('places serpentine in the upright orientation implied by the setup sheet', () => {
    const route = officialRoute('official-serpentine');
    expect(route.connections.map(({ from, edge, alignment, offset, to }) => ({ from, edge, alignment, offset, to }))).toEqual([
      { from: 'a', edge: 'right-down', alignment: undefined, offset: undefined, to: 'c' },
      { from: 'c', edge: 'right-up', alignment: undefined, offset: undefined, to: 'e' },
      { from: 'e', edge: 'left-up', alignment: undefined, offset: { q: -2, r: -5 }, to: 'g' },
      { from: 'g', edge: 'right-up', alignment: 'alternate', offset: undefined, to: 'j' },
      { from: 'j', edge: 'right-down', alignment: undefined, offset: undefined, to: 'm' },
    ]);
  });

  it('keeps serpentine non-connecting plates separated by visible gaps', () => {
    expect(plateContacts(officialRoute('official-serpentine'))).toEqual([
      { pair: 'a-c', overlap: 0, touch: 7 },
      { pair: 'c-e', overlap: 0, touch: 7 },
      { pair: 'e-g', overlap: 0, touch: 5 },
      { pair: 'g-j', overlap: 0, touch: 7 },
      { pair: 'j-m', overlap: 0, touch: 7 },
    ]);
  });

  it('places home stretch strip Q as the setup sheet shows', () => {
    const route = officialRoute('official-home-stretch');
    expect(route.connections.map(({ from, edge, alignment, offset, to }) => ({ from, edge, alignment, offset, to }))).toEqual([
      { from: 'b', edge: 'left-up', alignment: undefined, offset: undefined, to: 'j' },
      { from: 'j', edge: 'up', alignment: undefined, offset: { q: 3, r: -5 }, to: 'q' },
      { from: 'q', edge: 'up', alignment: undefined, offset: { q: 2, r: -5 }, to: 'k' },
      { from: 'k', edge: 'up', alignment: undefined, offset: undefined, to: 'm' },
      { from: 'm', edge: 'up', alignment: undefined, offset: undefined, to: 'c' },
    ]);
    expect(plateContacts(route)).toEqual([
      { pair: 'b-j', overlap: 0, touch: 7 },
      { pair: 'j-q', overlap: 0, touch: 8 },
      { pair: 'q-k', overlap: 0, touch: 8 },
      { pair: 'k-m', overlap: 0, touch: 7 },
      { pair: 'm-c', overlap: 0, touch: 7 },
    ]);
    expect(Object.fromEntries(route.plates.map((plate) => [plate.id, plate.rotation ?? 0]))).toEqual({
      b: 0,
      j: 4,
      q: 3,
      k: 5,
      m: 3,
      c: 5,
    });
    const map = OFFICIAL_MAPS['official-home-stretch'];
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'green', cost: 1 },
      { terrain: 'green', cost: 1 },
      { terrain: 'green', cost: 1 },
    ]);
  });

  it('places swamplands strips without accidental D-K or H-O shortcuts', () => {
    const route = officialRoute('official-swamplands');
    expect(route.connections.map(({ from, edge, alignment, offset, to }) => ({ from, edge, alignment, offset, to }))).toEqual([
      { from: 'a', edge: 'right-up', alignment: undefined, offset: { q: 5, r: -3 }, to: 'r' },
      { from: 'r', edge: 'right-down', alignment: undefined, offset: { q: 5, r: -2 }, to: 'd' },
      { from: 'd', edge: 'right-down', alignment: undefined, offset: undefined, to: 'h' },
      { from: 'h', edge: 'right-down', alignment: 'alternate', offset: undefined, to: 'e' },
      { from: 'e', edge: 'left-down', alignment: undefined, offset: { q: -5, r: 5 }, to: 'o' },
      { from: 'o', edge: 'left-down', alignment: undefined, offset: { q: -5, r: 2 }, to: 'k' },
    ]);
    expect(plateContacts(route)).toEqual([
      { pair: 'a-r', overlap: 0, touch: 8 },
      { pair: 'r-d', overlap: 0, touch: 8 },
      { pair: 'd-h', overlap: 0, touch: 7 },
      { pair: 'h-e', overlap: 0, touch: 7 },
      { pair: 'e-o', overlap: 0, touch: 5 },
      { pair: 'o-k', overlap: 0, touch: 8 },
    ]);
    expect(route.plates.find((plate) => plate.id === 'r')?.rotation).toBe(1);
    expect(route.plates.find((plate) => plate.id === 'd')?.rotation).toBe(2);
    expect(route.plates.find((plate) => plate.id === 'h')?.rotation).toBe(2);
    expect(route.plates.find((plate) => plate.id === 'e')?.rotation).toBe(1);
    expect(route.plates.find((plate) => plate.id === 'o')?.rotation).toBe(4);
    expect(route.plates.find((plate) => plate.id === 'k')?.role).toBe('end');
    expect(route.plates.find((plate) => plate.id === 'k')?.finishAnchor).toEqual({ q: -3, r: 3 });
  });

  it('keeps serpentine starts on the outside edge and uses blue El Dorado entrances', () => {
    expect(officialRoute('official-serpentine').plates.find((plate) => plate.id === 'm')?.finishAnchor).toEqual({
      q: 0,
      r: 3,
    });
    const map = OFFICIAL_MAPS['official-serpentine'];
    expect(map.startHexes).toEqual([
      { q: -3, r: 0 },
      { q: -3, r: 1 },
      { q: -3, r: 2 },
      { q: -3, r: 3 },
    ]);
    expect(map.finishHexes).toEqual([
      { q: 19, r: -1 },
      { q: 18, r: 0 },
      { q: 17, r: 0 },
    ]);
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
    ]);
  });

  it('places witchs cauldron terminal on I left corner and uses blue El Dorado entrances', () => {
    expect(officialRoute('official-witchs-cauldron').plates.find((plate) => plate.id === 'i')?.finishAnchor).toEqual({
      q: -3,
      r: 0,
    });
    const map = OFFICIAL_MAPS['official-witchs-cauldron'];
    expect(map.finishHexes).toEqual([
      { q: 3, r: 7 },
      { q: 2, r: 8 },
      { q: 2, r: 9 },
    ]);
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
    ]);
  });

  it('uses three identical blue entrances for the first official route terminal tile', () => {
    const map = OFFICIAL_MAPS['official-first'];
    const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
    expect(entrances.map((h) => ({ terrain: h.terrain, cost: h.cost }))).toEqual([
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
      { terrain: 'blue', cost: 1 },
    ]);
  });

  it('places the first official route terminal as the irregular ending tile', () => {
    const map = OFFICIAL_MAPS['official-first'];
    expect(map.finishHexes).toEqual([
      { q: 24, r: -1 },
      { q: 24, r: -2 },
      { q: 23, r: -2 },
    ]);
    expect(map.hexes.filter((h) => h.terrain === 'eldorado').map(({ q, r }) => ({ q, r }))).toEqual([
      { q: 24, r: -3 },
      { q: 25, r: -2 },
      { q: 25, r: -3 },
    ]);
  });

  it('assembles each official route into a playable board', () => {
    for (const map of Object.values(OFFICIAL_MAPS)) {
      expect(map.startHexes).toHaveLength(4);
      expect(map.finishHexes).toHaveLength(3);
      expect(map.hexes.some((h) => h.terrain === 'eldorado')).toBe(true);
      expect(map.blockades.length).toBeGreaterThan(0);
      const entrances = map.finishHexes.map((f) => map.hexes.find((h) => h.q === f.q && h.r === f.r)!);
      expect(entrances).toHaveLength(3);
      for (const entrance of entrances) {
        expect(entrance.finishEntrance).toBe(true);
        expect(['yellow', 'blue', 'green', 'rubble']).toContain(entrance.terrain);
        expect(entrance.cost).toBe(1);
      }
      expect(new Set(entrances.map((h) => h.terrain)).size).toBe(1);

      const hexKeys = new Set(map.hexes.map(key));
      for (const blockade of map.blockades) {
        expect(hexKeys.has(key(blockade.a))).toBe(true);
        expect(hexKeys.has(key(blockade.b))).toBe(true);
        expect(isAdjacent(blockade.a, blockade.b)).toBe(true);
        expect(blockade.cost).toBeGreaterThan(0);
      }
    }
  });
});
