/**
 * 板块解析器：把 7 行六边形 token 解析成 37 个本地蜂巢。
 * 行宽固定 4·5·6·7·6·5·4；axial r = row−3，中心 (0,0)。
 */
import type { Axial, Terrain } from '../types.js';

export const PLATE_ROW_WIDTHS = [4, 5, 6, 7, 6, 5, 4] as const;

export interface PlateDef {
  id: string;
  theme: string; // 仅用于贴图/视觉
  rows: string[];
}

export interface PlateCell {
  local: Axial;
  terrain: Terrain;
  cost: number;
  slot?: number; // 起点槽位 1..4（terrain === 'start' 时）
}

export interface ParsedPlate {
  id: string;
  theme: string;
  cells: PlateCell[];
}

const TERRAIN_BY_LETTER: Record<string, Terrain> = {
  g: 'green',
  b: 'blue',
  y: 'yellow',
  R: 'rubble',
  C: 'basecamp',
};

/** Zero-based row/col within the hex layout → local axial coordinate (centre 0,0). */
export function localFromRowCol(row: number, col: number): Axial {
  const r = row - 3;
  const qStart = Math.max(-3, -3 - r);
  return { q: qStart + col, r };
}

function cellFromToken(tok: string, plateId: string): { terrain: Terrain; cost: number; slot?: number } {
  if (tok === 'MM') return { terrain: 'mountain', cost: 0 };
  const first = tok[0];
  if (first === 'S') {
    const slot = Number(tok.slice(1));
    if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
      throw new Error(`板块 ${plateId} 起点槽位错误：${tok}`);
    }
    return { terrain: 'start', cost: 0, slot };
  }
  const terrain = TERRAIN_BY_LETTER[first];
  if (!terrain) throw new Error(`板块 ${plateId} 未知地图标记：${tok}`);
  const cost = Number(tok.slice(1));
  if (!Number.isInteger(cost) || cost < 1 || cost > 4) {
    throw new Error(`板块 ${plateId} 地图标记消耗值错误：${tok}`);
  }
  return { terrain, cost };
}

export function parsePlate(def: PlateDef): ParsedPlate {
  if (def.rows.length !== PLATE_ROW_WIDTHS.length) {
    throw new Error(`板块 ${def.id} 必须为 ${PLATE_ROW_WIDTHS.length} 行`);
  }
  const cells: PlateCell[] = [];
  def.rows.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/);
    const want = PLATE_ROW_WIDTHS[row];
    if (tokens.length !== want) {
      throw new Error(`板块 ${def.id} 第 ${row + 1} 行应有 ${want} 格，实为 ${tokens.length}`);
    }
    tokens.forEach((tok, col) => {
      const spec = cellFromToken(tok, def.id);
      const cell: PlateCell = { local: localFromRowCol(row, col), terrain: spec.terrain, cost: spec.cost };
      if (spec.slot !== undefined) cell.slot = spec.slot;
      cells.push(cell);
    });
  });
  return { id: def.id, theme: def.theme, cells };
}
