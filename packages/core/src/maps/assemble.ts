/**
 * 拼装器：连接表 → 放置板块 → 物化世界蜂巢。
 * 障碍与黄金城在同文件后续函数中追加（见 buildSeamBlockades / attachEldorado）。
 */
import type { GameMap, Hex, Axial, MoveSymbol } from '../types.js';
import { key } from '../hex.js';
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
      const k = `${q},${r}`;
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

export function assembleMap(def: MapDef, library: Record<string, PlateDef>): GameMap {
  const placed = placePlates(def, library);
  const { hexes, startHexes } = materialize(placed);
  return {
    id: def.id,
    name: def.name,
    hexes,
    blockades: [],
    startHexes,
    finishHexes: [],
  };
}
