/**
 * 拼装器：连接表 → 放置板块 → 物化世界蜂巢。
 * 障碍与黄金城在同文件后续函数中追加（见 buildSeamBlockades / attachEldorado）。
 */
import type { GameMap, Hex, Axial, MoveSymbol, Blockade, BlockadeEdge, Terrain } from '../types.js';
import { key, neighbors, axialToPixel, distance } from '../hex.js';
import {
  EDGE_OFFSET,
  edgeOffset,
  localCells,
  TILE_RADIUS,
  type TileEdge,
  type TileEdgeAlignment,
} from './geometry.js';
import { parsePlate, type PlateDef, type ParsedPlate } from './plate.js';

export type BlockadeType = MoveSymbol | 'discard';

export interface BlockadeDef {
  type: BlockadeType;
  cost: number;
}

export interface MapConnectionDef {
  from: string;
  edge: TileEdge;
  to: string;
  /** Full-edge zigzag alignment. The alternate phase shifts the neighbour by one seam step. */
  alignment?: TileEdgeAlignment;
  /** Explicit centre offset for official setups whose edge phase leaves a visual gap to nearby plates. */
  offset?: Axial;
  blockade?: BlockadeDef;
}

export interface MapPlateRef {
  id: string;
  ref: string;
  role?: 'end';
  /** Edge where the El Dorado terminal tile attaches when role === 'end'. */
  finishEdge?: TileEdge;
  /** Local boundary cell used as the El Dorado terminal corner anchor after rotation. */
  finishAnchor?: Axial;
  /** Clockwise 60-degree rotation steps, 0..5. */
  rotation?: number;
}

export type FinishEntranceTerrain = Extract<Terrain, 'green' | 'blue' | 'yellow' | 'rubble'>;

export interface MapDef {
  id: string;
  name: string;
  plates: MapPlateRef[];
  connections: MapConnectionDef[];
  /** Terrain used by all three spaces immediately before El Dorado. Cost is always 1. */
  finishEntranceTerrain?: FinishEntranceTerrain;
  /** Legacy shape accepted only when all three entries are the same. */
  finishEntrances?: FinishEntranceTerrain[];
}

export interface PlacedPlate {
  instanceId: string;
  plate: ParsedPlate;
  role?: 'end';
  finishEdge?: TileEdge;
  finishAnchor?: Axial;
  center: Axial;
}

function rotateAxialClockwise(c: Axial): Axial {
  return { q: -c.r, r: c.q + c.r };
}

function normalizedRotation(ref: MapPlateRef, mapId: string): number {
  const rotation = ref.rotation ?? 0;
  if (!Number.isInteger(rotation) || rotation < 0 || rotation > 5) {
    throw new Error(`地图 ${mapId} 板块 ${ref.id} 旋转值必须是 0..5 的整数`);
  }
  return rotation;
}

function rotatePlate(plate: ParsedPlate, rotation: number): ParsedPlate {
  if (rotation === 0) return plate;
  return {
    ...plate,
    cells: plate.cells.map((cell) => {
      let local = cell.local;
      for (let i = 0; i < rotation; i++) local = rotateAxialClockwise(local);
      return { ...cell, local };
    }),
  };
}

function connectionOffset(conn: MapConnectionDef): Axial {
  return conn.offset ? { ...conn.offset } : edgeOffset(conn.edge, conn.alignment);
}

function assertConnectionOffset(def: MapDef, conn: MapConnectionDef): void {
  if (!conn.offset) return;
  if (conn.alignment) {
    throw new Error(`地图 ${def.id} 连接 ${conn.from}->${conn.to} 不能同时设置 offset 和 alignment`);
  }
  if (!Number.isInteger(conn.offset.q) || !Number.isInteger(conn.offset.r)) {
    throw new Error(`地图 ${def.id} 连接 ${conn.from}->${conn.to} 的 offset 必须是整数轴坐标`);
  }
}

export function placePlates(def: MapDef, library: Record<string, PlateDef>): PlacedPlate[] {
  if (def.plates.length === 0) throw new Error(`地图 ${def.id} 没有板块`);

  const parsed = new Map<string, ParsedPlate>();
  const meta = new Map<string, MapPlateRef>();
  for (const ref of def.plates) {
    const plateDef = library[ref.ref];
    if (!plateDef) throw new Error(`地图 ${def.id} 引用了未知板块：${ref.ref}`);
    parsed.set(ref.id, rotatePlate(parsePlate(plateDef), normalizedRotation(ref, def.id)));
    meta.set(ref.id, ref);
  }

  for (const conn of def.connections) {
    if (!meta.has(conn.from)) throw new Error(`地图 ${def.id} 连接引用未知板块：${conn.from}`);
    if (!meta.has(conn.to)) throw new Error(`地图 ${def.id} 连接引用未知板块：${conn.to}`);
    assertConnectionOffset(def, conn);
  }

  const centers = new Map<string, Axial>();
  const root = def.plates[0].id;
  centers.set(root, { q: 0, r: 0 });

  // BFS over connections (undirected): once one endpoint is placed, place the other.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const conn of def.connections) {
      const fromPlaced = centers.get(conn.from);
      const toPlaced = centers.get(conn.to);
      const offset = connectionOffset(conn);
      if (fromPlaced && !toPlaced) {
        centers.set(conn.to, { q: fromPlaced.q + offset.q, r: fromPlaced.r + offset.r });
        progressed = true;
      } else if (toPlaced && !fromPlaced) {
        centers.set(conn.from, { q: toPlaced.q - offset.q, r: toPlaced.r - offset.r });
        progressed = true;
      } else if (fromPlaced && toPlaced) {
        // Consistency check: the seam must agree with the declared edge.
        const expected = { q: fromPlaced.q + offset.q, r: fromPlaced.r + offset.r };
        if (expected.q !== toPlaced.q || expected.r !== toPlaced.r) {
          throw new Error(`地图 ${def.id} 板块 ${conn.to} 定位冲突`);
        }
      }
    }
  }

  if (centers.size !== def.plates.length) {
    throw new Error(`地图 ${def.id} 板块未连通：${def.plates.length - centers.size} 块无法定位`);
  }

  return def.plates.map((ref) => {
    const placed: PlacedPlate = {
      instanceId: ref.id,
      plate: parsed.get(ref.id)!,
      center: centers.get(ref.id)!,
    };
    if (ref.role) placed.role = ref.role;
    if (ref.finishEdge) placed.finishEdge = ref.finishEdge;
    if (ref.finishAnchor) placed.finishAnchor = { ...ref.finishAnchor };
    return placed;
  });
}

/** Translate every placed plate's cells into a deduped world hex list + start hexes. */
function materialize(placed: PlacedPlate[]): { hexes: Hex[]; startHexes: Axial[] } {
  const hexByKey = new Map<string, Hex>();
  const starts: Array<{ slot: number; coord: Axial }> = [];

  for (const p of placed) {
    for (const c of p.plate.cells) {
      const q = p.center.q + c.local.q;
      const r = p.center.r + c.local.r;
      const k = key({ q, r });
      if (hexByKey.has(k)) continue; // shared-seam dedupe (safety net)
      const hex: Hex = { q, r, terrain: c.terrain, cost: c.cost };
      if (c.slot !== undefined) hex.slot = c.slot;
      if (c.cave) hex.cave = true;
      hexByKey.set(k, hex);
      if (c.terrain === 'start' && c.slot !== undefined) starts.push({ slot: c.slot, coord: { q, r } });
    }
  }

  starts.sort((a, b) => a.slot - b.slot);
  return { hexes: [...hexByKey.values()], startHexes: starts.map((s) => s.coord) };
}

function blockadeTerrain(type: BlockadeType): { terrain: Terrain; symbol?: MoveSymbol } {
  switch (type) {
    case 'machete':
      return { terrain: 'green', symbol: 'machete' };
    case 'paddle':
      return { terrain: 'blue', symbol: 'paddle' };
    case 'coin':
      return { terrain: 'yellow', symbol: 'coin' };
    case 'discard':
      return { terrain: 'rubble' };
  }
}

function isBlockadeCandidate(hex: Hex): boolean {
  return hex.terrain !== 'mountain' && hex.terrain !== 'rubble' && hex.terrain !== 'basecamp';
}

function worldCells(p: PlacedPlate): Axial[] {
  return p.plate.cells.map((c) => ({ q: p.center.q + c.local.q, r: p.center.r + c.local.r }));
}

function buildSeamBlockades(def: MapDef, placed: PlacedPlate[], hexes: Hex[]): Blockade[] {
  const byId = new Map(placed.map((p) => [p.instanceId, p]));
  const byKey = new Map(hexes.map((h) => [key(h), h]));
  const blockades: Blockade[] = [];

  def.connections.forEach((conn, index) => {
    if (!conn.blockade) return;
    const from = byId.get(conn.from)!;
    const to = byId.get(conn.to)!;
    const toKeys = new Set(worldCells(to).map(key));
    const fromCenter = axialToPixel(from.center, 1);
    const toCenter = axialToPixel(to.center, 1);
    const seamMid = { x: (fromCenter.x + toCenter.x) / 2, y: (fromCenter.y + toCenter.y) / 2 };
    const cdx = toCenter.x - fromCenter.x;
    const cdy = toCenter.y - fromCenter.y;
    const clen = Math.hypot(cdx, cdy) || 1;
    const seamDir = { x: -cdy / clen, y: cdx / clen };

    const pairs: Array<{ a: Hex; b: Hex; score: number; order: number }> = [];
    for (const aCell of worldCells(from)) {
      const a = byKey.get(key(aCell));
      if (!a) continue;
      for (const n of neighbors(a)) {
        if (!toKeys.has(key(n))) continue;
        const b = byKey.get(key(n));
        if (!b) continue;
        const pa = axialToPixel(a, 1);
        const pb = axialToPixel(b, 1);
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const score = Math.hypot(mid.x - seamMid.x, mid.y - seamMid.y);
        const order = (mid.x - seamMid.x) * seamDir.x + (mid.y - seamMid.y) * seamDir.y;
        pairs.push({ a, b, score, order });
      }
    }
    if (pairs.length === 0) return;
    pairs.sort((l, r) => l.order - r.order || key(l.a).localeCompare(key(r.a)));

    const chosen =
      pairs
        .filter((p) => isBlockadeCandidate(p.a) && isBlockadeCandidate(p.b))
        .sort((l, r) => l.score - r.score || key(l.a).localeCompare(key(r.a)))[0] ?? pairs[0];

    const { terrain, symbol } = blockadeTerrain(conn.blockade.type);
    const edges: BlockadeEdge[] = pairs.map((p) => ({
      a: { q: p.a.q, r: p.a.r },
      b: { q: p.b.q, r: p.b.r },
    }));
    const blockade: Blockade = {
      id: `seam-${index + 1}-${conn.edge}`,
      a: { q: chosen.a.q, r: chosen.a.r },
      b: { q: chosen.b.q, r: chosen.b.r },
      edges,
      terrain,
      cost: conn.blockade.cost,
    };
    if (symbol) blockade.symbol = symbol;
    blockades.push(blockade);
  });

  return blockades;
}

export const ELDORADO_ENTRANCE_COST = 1;
const DEFAULT_FINISH_ENTRANCE_TERRAIN: FinishEntranceTerrain = 'blue';

function assertFinishEntranceTerrain(def: MapDef, terrain: FinishEntranceTerrain): FinishEntranceTerrain {
  if (terrain !== 'green' && terrain !== 'blue' && terrain !== 'yellow' && terrain !== 'rubble') {
    throw new Error(`地图 ${def.id} 的黄金城入口地形不支持：${terrain}`);
  }
  return terrain;
}

function finishEntranceTerrainFor(def: MapDef): FinishEntranceTerrain {
  if (def.finishEntranceTerrain) return assertFinishEntranceTerrain(def, def.finishEntranceTerrain);
  if (!def.finishEntrances) return DEFAULT_FINISH_ENTRANCE_TERRAIN;

  if (def.finishEntrances.length !== 3) throw new Error(`地图 ${def.id} 的黄金城入口必须正好 3 格`);
  const [terrain] = def.finishEntrances;
  if (!terrain) throw new Error(`地图 ${def.id} 的黄金城入口缺少地形`);
  assertFinishEntranceTerrain(def, terrain);
  if (def.finishEntrances.some((entry) => entry !== terrain)) {
    throw new Error(`地图 ${def.id} 的三个黄金城入口必须是相同地形`);
  }
  return terrain;
}

function sortAlongEdge(edge: TileEdge, cells: Axial[]): Axial[] {
  const center = axialToPixel({ q: 0, r: 0 }, 1);
  const adjacent = axialToPixel(EDGE_OFFSET[edge], 1);
  const normal = { x: adjacent.x - center.x, y: adjacent.y - center.y };
  const normalLength = Math.hypot(normal.x, normal.y) || 1;
  normal.x /= normalLength;
  normal.y /= normalLength;
  const tangent = { x: -normal.y, y: normal.x };
  return cells.slice().sort((a, b) => {
    const pa = axialToPixel(a, 1);
    const pb = axialToPixel(b, 1);
    const ao = pa.x * tangent.x + pa.y * tangent.y;
    const bo = pb.x * tangent.x + pb.y * tangent.y;
    return ao - bo || key(a).localeCompare(key(b));
  });
}

function localEdgeCells(edge: TileEdge): Axial[] {
  const offset = EDGE_OFFSET[edge];
  const adjacentTileKeys = new Set(
    localCells().map((c) => key({ q: c.q + offset.q, r: c.r + offset.r })),
  );
  return sortAlongEdge(
    edge,
    localCells().filter((c) => neighbors(c).some((n) => adjacentTileKeys.has(key(n)))),
  );
}

function anchorCellFor(end: PlacedPlate, boundary: Axial[], startCenter: Axial): Axial | undefined {
  if (end.finishAnchor) {
    const anchor = { q: end.center.q + end.finishAnchor.q, r: end.center.r + end.finishAnchor.r };
    if (!boundary.some((c) => c.q === anchor.q && c.r === anchor.r)) {
      throw new Error(`终点板块 ${end.instanceId} 的 finishAnchor 不在指定边界上`);
    }
    return anchor;
  }
  return boundary
    .slice()
    .sort((a, b) => distance(b, startCenter) - distance(a, startCenter) || key(a).localeCompare(key(b)))[0];
}

function eldoradoCity(gate: Axial, arms: Axial[], occupied: Set<string>): Axial[] {
  const entrances = [gate, ...arms];
  return neighbors(gate)
    .filter((c) => !occupied.has(key(c)))
    .filter((c) => entrances.some((e) => neighbors(c).some((n) => n.q === e.q && n.r === e.r)))
    .sort((a, b) => key(a).localeCompare(key(b)))
    .slice(0, 3)
    .map((c) => ({ q: c.q, r: c.r }));
}

function attachEldorado(map: GameMap, def: MapDef, end: PlacedPlate, startCenter: Axial): GameMap {
  const occupied = new Set(map.hexes.map(key));
  const adj = (a: Axial, b: Axial) => neighbors(a).some((n) => n.q === b.q && n.r === b.r);
  const entranceTerrain = finishEntranceTerrainFor(def);

  const boundary = (end.finishEdge
    ? localEdgeCells(end.finishEdge)
    : localCells().filter((c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) === TILE_RADIUS)
  ).map((c) => ({ q: end.center.q + c.q, r: end.center.r + c.r }));
  const k = anchorCellFor(end, boundary, startCenter);
  if (!k) return map;

  const ext = neighbors(k).filter((n) => !occupied.has(key(n)));
  if (!ext.length) return map;
  const flankCount = (c: Axial) => ext.filter((o) => o !== c && adj(o, c)).length;
  const gate = ext
    .slice()
    .sort((a, b) => flankCount(b) - flankCount(a) || distance(b, startCenter) - distance(a, startCenter))[0];
  const arms = ext.filter((o) => o !== gate && adj(o, gate)).slice(0, 2);

  const hexes = map.hexes.slice();
  const entrances = [arms[0], gate, arms[1]].filter((c): c is Axial => !!c);
  entrances.forEach((c, i) => {
    if (occupied.has(key(c))) return;
    occupied.add(key(c));
    hexes.push({
      q: c.q,
      r: c.r,
      terrain: entranceTerrain,
      cost: ELDORADO_ENTRANCE_COST,
      finishEntrance: true,
      slot: i + 1,
    });
  });

  for (const c of eldoradoCity(gate, arms, occupied)) {
    occupied.add(key(c));
    hexes.push({ q: c.q, r: c.r, terrain: 'eldorado', cost: 0 });
  }
  return { ...map, hexes, finishHexes: entrances.map((c) => ({ q: c.q, r: c.r })) };
}

export function assembleMap(def: MapDef, library: Record<string, PlateDef>): GameMap {
  const placed = placePlates(def, library);
  const { hexes, startHexes } = materialize(placed);
  const blockades = buildSeamBlockades(def, placed, hexes);
  const base: GameMap = {
    id: def.id,
    name: def.name,
    hexes,
    blockades,
    startHexes,
    finishHexes: [],
  };
  const end = placed.find((p) => p.role === 'end');
  if (!end) return base;
  const startCenter = placed[0]?.center ?? { q: 0, r: 0 };
  return attachEldorado(base, def, end, startCenter);
}
