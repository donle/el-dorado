import type { GameMap } from '../types.js';
import { parseGrid } from './parse.js';
import { assembleMap, type MapDef } from './assemble.js';
import type { PlateDef } from './plate.js';

import startA from './data/plates/start-a.json' with { type: 'json' };
import jungleA from './data/plates/jungle-a.json' with { type: 'json' };
import riverA from './data/plates/river-a.json' with { type: 'json' };
import villageA from './data/plates/village-a.json' with { type: 'json' };
import endA from './data/plates/end-a.json' with { type: 'json' };
import classicDef from './data/classic.map.json' with { type: 'json' };
import officialPlates from './data/official-plates.json' with { type: 'json' };
import officialRouteDefs from './data/official-routes.map.json' with { type: 'json' };

const PLATE_LIBRARY: Record<string, PlateDef> = {
  'start-a': startA as PlateDef,
  'jungle-a': jungleA as PlateDef,
  'river-a': riverA as PlateDef,
  'village-a': villageA as PlateDef,
  'end-a': endA as PlateDef,
  ...(officialPlates as unknown as Record<string, PlateDef>),
};

/**
 * "Classic" 地图：完全由 JSON 板块 + 连接表装配，等价于旧程序化版本。
 * start → jungle → river → village → end(+黄金城)，四条接缝各一障碍。
 */
export const CLASSIC_MAP: GameMap = assembleMap(classicDef as MapDef, PLATE_LIBRARY);
const OFFICIAL_ROUTE_DEFS = officialRouteDefs as MapDef[];
export const OFFICIAL_MAPS: Record<string, GameMap> = Object.fromEntries(
  OFFICIAL_ROUTE_DEFS.map((def) => [def.id, assembleMap(def, PLATE_LIBRARY)]),
) as Record<string, GameMap>;

/** Simple 2-lane corridor — used by unit tests with fixed coordinates. */
export const CORRIDOR_MAP: GameMap = parseGrid('corridor', '测试走廊', [
  'S1 S3 g1 g2 b1 b2 y1 R2 g3 y2 b3 g2 C2 y3 g4 b3 g2 F1 F3',
  'S2 S4 g1 g1 g2 b1 y2 g2 b2 y1 MM g3 y2 b2 g2 y3 b2 F2 --',
]);

export const MAPS: Record<string, GameMap> = {
  classic: CLASSIC_MAP,
  ...OFFICIAL_MAPS,
  corridor: CORRIDOR_MAP,
};

export const PLAYABLE_MAP_IDS = ['classic', ...OFFICIAL_ROUTE_DEFS.map((def) => def.id)] as const;

export const MAP_OPTIONS = PLAYABLE_MAP_IDS.map((id) => ({
  id,
  name: MAPS[id].name,
}));

export function getMap(id: string): GameMap {
  const m = MAPS[id];
  if (!m) throw new Error(`未知地图：${id}`);
  return m;
}

export { parseGrid };
export { assembleMap } from './assemble.js';
export type { MapDef, MapConnectionDef, MapPlateRef, BlockadeDef, BlockadeType } from './assemble.js';
export { parsePlate } from './plate.js';
export type { PlateDef, ParsedPlate, PlateCell } from './plate.js';
export {
  neighborCenter,
  TILE_RADIUS,
  TILE_EDGES,
  EDGE_OFFSET,
  ALTERNATE_EDGE_OFFSET,
  OPPOSITE_EDGE,
  TILE_NEIGHBOR_OFFSETS,
  edgeOffset,
} from './geometry.js';
export type { TileEdge, TileEdgeAlignment } from './geometry.js';
