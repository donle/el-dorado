/**
 * controllers/TerrainInfo — pure helpers that turn a `Hex` or `Blockade`
 * into the Chinese name / icon / description / cost-text used by the
 * hover panel, market inline detail, and blockade preview.
 *
 * Moved out of `main.ts` so HoverStateMachine can import directly without
 * going through the App host interface. All functions are deterministic
 * and side-effect free.
 */
import { terrainSymbol, blockadeMoveSymbol } from '@eldorado/core';
import type { Blockade, Hex, Terrain } from '@eldorado/core';
import { SYMBOL_GLYPH, SYMBOL_LABEL } from '../views/common/iconMap.js';

export type TerrainInfo = { name: string; icon: string; description: string; rule: string };

export const TERRAIN_INFO: Record<Terrain, TerrainInfo> = {
  green: {
    name: '丛林',
    icon: '🗡️',
    description: '潮湿密集的雨林区域，队伍需要砍开藤蔓和灌木才能前进。',
    rule: '进入此格需要砍刀移动力，消耗等于格子上的数字。',
  },
  blue: {
    name: '河流',
    icon: '🛶',
    description: '河道与浅滩交错的水域，必须依靠船桨和水路经验通过。',
    rule: '进入此格需要船桨移动力，消耗等于格子上的数字。',
  },
  yellow: {
    name: '村庄',
    icon: '🪙',
    description: '村落、道路和交易点组成的陆路区域，金币可以换来向导和补给。',
    rule: '进入此格需要金币移动力，消耗等于格子上的数字。',
  },
  rubble: {
    name: '碎石障碍',
    icon: '⛏',
    description: '坍塌的石堆挡住去路，需要丢弃补给和工具来清出通道。',
    rule: '点击相邻碎石格后，选择指定数量的手牌弃掉，然后棋子进入该格。',
  },
  basecamp: {
    name: '营地障碍',
    icon: '⛺',
    description: '临时营地占住路线，穿过这里会消耗并淘汰一部分随身装备。',
    rule: '点击相邻营地格后，选择指定数量的手牌永久移出游戏，然后棋子进入该格。',
  },
  mountain: {
    name: '山地',
    icon: '⛰',
    description: '陡峭岩脊和高地阻隔路线，是地图上的天然屏障。',
    rule: '普通移动不能进入山地；原住民向导可以无视地形移动到相邻山地。',
  },
  start: {
    name: '起点营地',
    icon: '🚩',
    description: '探险队出发的位置，也是路线回环时可以经过的普通格。',
    rule: '进入起点格消耗 1 点任意移动力。',
  },
  finish: {
    name: '黄金城入口',
    icon: '🏆',
    description: '通向黄金城的最后入口。先进入入口，再从入口踏上黄金城主体，才算抵达终点。',
    rule: '进入入口需要满足格子的移动符号和消耗。',
  },
  eldorado: {
    name: '黄金城',
    icon: '🏛',
    description: '传说中的黄金城主体区域。探险队必须从任一黄金城入口踏上这里才算完成旅程。',
    rule: '只能从相邻的黄金城入口进入；最终踏入黄金城不需要出牌。进入后触发最终结算阶段。',
  },
};

export function terrainInfo(hex: Hex): TerrainInfo {
  if (hex.finishEntrance && hex.terrain !== 'finish') {
    const base = TERRAIN_INFO[hex.terrain];
    return {
      ...base,
      name: `${base.name}入口`,
      description: `${base.description} 这里也是黄金城前的入口格。`,
      rule: `${terrainCostText(hex)}。先进入此入口，再从入口踏上黄金城主体，才算抵达终点。`,
    };
  }
  if (hex.terrain !== 'finish') return TERRAIN_INFO[hex.terrain];
  const symbol = hex.reqSymbol ? `${SYMBOL_GLYPH[hex.reqSymbol]}${SYMBOL_LABEL[hex.reqSymbol]}` : '任意移动力';
  return {
    ...TERRAIN_INFO.finish,
    rule: `进入入口需要 ${symbol}，消耗 ${Math.max(hex.cost, 1)} 点。入口本身不是终点，还需要再进入黄金城。`,
  };
}

export function blockadeTerrain(blockade: Blockade): Terrain {
  if (blockade.terrain) return blockade.terrain;
  if (blockade.symbol === 'machete') return 'green';
  if (blockade.symbol === 'paddle') return 'blue';
  if (blockade.symbol === 'coin') return 'yellow';
  return 'yellow';
}

export function blockadeInfo(blockade: Blockade): TerrainInfo {
  const terrain = blockadeTerrain(blockade);
  const base = TERRAIN_INFO[terrain];
  return {
    name: `${base.name}连接地形`,
    icon: base.icon,
    description: `连接两个大陆板块边缘的 Z 字形地形，地貌为${base.name}。它不是装饰物，而是可以被选择并穿越的路线。`,
    rule: `从这块地形覆盖的任一边跨到另一侧时，需要 ${blockadeCostText(blockade)}。第一位通过的玩家会领取这块连接地形，后续结算会记录在玩家信息中。`,
  };
}

export function terrainCostText(hex: Hex): string {
  if (hex.terrain === 'mountain') return '普通移动不可进入';
  if (hex.terrain === 'eldorado') return '无需出牌';
  if (hex.terrain === 'rubble') return `清除费用 ${hex.cost} 张手牌`;
  if (hex.terrain === 'basecamp') return `移除费用 ${hex.cost} 张手牌`;
  if (hex.terrain === 'start') return '进入消耗 1 点任意移动力';
  if (hex.terrain === 'finish') {
    const symbol = hex.reqSymbol ? `${SYMBOL_GLYPH[hex.reqSymbol]} ${SYMBOL_LABEL[hex.reqSymbol]}` : '任意移动力';
    return `${symbol} ${Math.max(hex.cost, 1)} 点`;
  }
  const symbol = terrainSymbol(hex.terrain);
  return symbol ? `${SYMBOL_GLYPH[symbol]} ${SYMBOL_LABEL[symbol]} ${hex.cost} 点` : `消耗 ${hex.cost}`;
}

export function blockadeCostText(blockade: Blockade): string {
  const symbol = blockadeMoveSymbol(blockade);
  if (!symbol) return `⛏ 弃 ${blockade.cost} 张手牌`;
  return `${SYMBOL_GLYPH[symbol]} ${SYMBOL_LABEL[symbol]} ${blockade.cost} 点`;
}