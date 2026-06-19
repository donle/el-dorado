/**
 * 拼装器：连接表 → 放置板块 → 物化世界蜂巢。
 * 障碍与黄金城在同文件后续函数中追加（见 buildSeamBlockades / attachEldorado）。
 */
import type { GameMap, Hex, Axial, MoveSymbol, Blockade, BlockadeEdge, Terrain } from '../types.js';
import { key, neighbors, axialToPixel } from '../hex.js';
import { OPPOSITE_EDGE, neighborCenter, type TileEdge } from './geometry.js';
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
  blockade?: BlockadeDef;
}

export interface MapPlateRef {
  id: string;
  ref: string;
  role?: 'end';
}

export interface MapDef {
  id: string;
  name: string;
  plates: MapPlateRef[];
  connections: MapConnectionDef[];
}

export interface PlacedPlate {
  instanceId: string;
  plate: ParsedPlate;
  role?: 'end';
  center: Axial;
}

export function placePlates(def: MapDef, library: Record<string, PlateDef>): PlacedPlate[] {
  if (def.plates.length === 0) throw new Error(`地图 ${def.id} 没有板块`);

  const parsed = new Map<string, ParsedPlate>();
  const meta = new Map<string, MapPlateRef>();
  for (const ref of def.plates) {
    const plateDef = library[ref.ref];
    if (!plateDef) throw new Error(`地图 ${def.id} 引用了未知板块：${ref.ref}`);
    parsed.set(ref.id, parsePlate(plateDef));
    meta.set(ref.id, ref);
  }

  for (const conn of def.connections) {
    if (!meta.has(conn.from)) throw new Error(`地图 ${def.id} 连接引用未知板块：${conn.from}`);
    if (!meta.has(conn.to)) throw new Error(`地图 ${def.id} 连接引用未知板块：${conn.to}`);
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
      if (fromPlaced && !toPlaced) {
        centers.set(conn.to, neighborCenter(fromPlaced, conn.edge));
        progressed = true;
      } else if (toPlaced && !fromPlaced) {
        centers.set(conn.from, neighborCenter(toPlaced, OPPOSITE_EDGE[conn.edge]));
        progressed = true;
      } else if (fromPlaced && toPlaced) {
        // Consistency check: the seam must agree with the declared edge.
        const expected = neighborCenter(fromPlaced, conn.edge);
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

export function assembleMap(def: MapDef, library: Record<string, PlateDef>): GameMap {
  const placed = placePlates(def, library);
  const { hexes, startHexes } = materialize(placed);
  const blockades = buildSeamBlockades(def, placed, hexes);
  return {
    id: def.id,
    name: def.name,
    hexes,
    blockades,
    startHexes,
    finishHexes: [],
  };
}
