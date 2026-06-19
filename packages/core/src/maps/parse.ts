/**
 * Tiny grid DSL → GameMap.
 *
 * The map is authored as two (or more) lanes of whitespace-separated tokens.
 * Row index = odd-r offset row, token index = offset column. Tokens:
 *   --            no hex
 *   S1..S4        start hex (slot number)
 *   F1..F3        finish hex
 *   MM            mountain (impassable)
 *   g1..g4        green / machete, cost = digit
 *   b1..b4        blue / paddle
 *   y1..y4        yellow / coin
 *   R1..R4        rubble (pay any cards → discard)
 *   C1..C4        basecamp (pay any cards → removed from game)
 */
import type { GameMap, Hex, Terrain, Axial } from '../types.js';
import { offsetToAxial } from '../hex.js';

const TERRAIN_BY_LETTER: Record<string, Terrain> = {
  g: 'green',
  b: 'blue',
  y: 'yellow',
  R: 'rubble',
  C: 'basecamp',
};

export function parseGrid(id: string, name: string, lanes: string[]): GameMap {
  const hexes: Hex[] = [];
  const startHexes: Array<{ slot: number; coord: Axial }> = [];
  const finishHexes: Axial[] = [];

  lanes.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/);
    tokens.forEach((tok, col) => {
      if (tok === '--') return;
      const coord = offsetToAxial(row, col);
      const first = tok[0];

      if (first === 'S') {
        const slot = Number(tok.slice(1));
        hexes.push({ ...coord, terrain: 'start', cost: 0, slot });
        startHexes.push({ slot, coord });
      } else if (first === 'F') {
        const slot = Number(tok.slice(1));
        hexes.push({ ...coord, terrain: 'finish', cost: 0, slot });
        finishHexes.push(coord);
      } else if (tok === 'MM') {
        hexes.push({ ...coord, terrain: 'mountain', cost: 0 });
      } else {
        const terrain = TERRAIN_BY_LETTER[first];
        if (!terrain) throw new Error(`未知地图标记：${tok}`);
        const cost = Number(tok.slice(1));
        if (!Number.isInteger(cost) || cost < 1 || cost > 4) {
          throw new Error(`地图标记消耗值错误：${tok}`);
        }
        hexes.push({ ...coord, terrain, cost });
      }
    });
  });

  startHexes.sort((a, b) => a.slot - b.slot);
  return {
    id,
    name,
    hexes,
    blockades: [],
    startHexes: startHexes.map((s) => s.coord),
    finishHexes,
  };
}
