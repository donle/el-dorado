/**
 * Card catalog for The Quest for El Dorado.
 *
 * Values marked `// TODO: verify` are not confirmed by the official text
 * sources (they live in card art); they use community/best-estimate values and
 * are collected here for easy correction against physical cards.
 */
import type { CardDef, Card, MoveSymbol } from './types.js';

export const CARD_DEFS: Record<string, CardDef> = {
  // --- Starting deck (not sold) ---
  explorer: { defId: 'explorer', name: '探险家', kind: 'green', symbol: 'machete', power: 1, cost: 0, starting: true },
  traveller: { defId: 'traveller', name: '旅行者', kind: 'yellow', symbol: 'coin', power: 1, cost: 0, starting: true },
  sailor: { defId: 'sailor', name: '水手', kind: 'blue', symbol: 'paddle', power: 1, cost: 0, starting: true },

  // --- Green / machete ---
  scout: { defId: 'scout', name: '侦察员', kind: 'green', symbol: 'machete', power: 2, cost: 1 },
  trailblazer: { defId: 'trailblazer', name: '开路先锋', kind: 'green', symbol: 'machete', power: 3, cost: 3 },
  pioneer: { defId: 'pioneer', name: '先驱者', kind: 'green', symbol: 'machete', power: 5, cost: 5 },
  giant_machete: { defId: 'giant_machete', name: '巨型砍刀', kind: 'green', symbol: 'machete', power: 5, cost: 4, singleUse: true }, // TODO: verify cost

  // --- Blue / paddle ---
  captain: { defId: 'captain', name: '船长', kind: 'blue', symbol: 'paddle', power: 3, cost: 2 },

  // --- Yellow / coin ---
  photographer: { defId: 'photographer', name: '摄影师', kind: 'yellow', symbol: 'coin', power: 2, cost: 2 },
  journalist: { defId: 'journalist', name: '记者', kind: 'yellow', symbol: 'coin', power: 3, cost: 3 },
  treasure_chest: { defId: 'treasure_chest', name: '宝箱', kind: 'yellow', symbol: 'coin', power: 4, cost: 3, singleUse: true }, // TODO: verify cost
  millionaire: { defId: 'millionaire', name: '百万富翁', kind: 'yellow', symbol: 'coin', power: 4, cost: 5 },

  // --- White / joker (pick one symbol when played) ---
  jack: { defId: 'jack', name: '万事通', kind: 'joker', power: 1, cost: 1 },
  adventurer: { defId: 'adventurer', name: '冒险家', kind: 'joker', power: 2, cost: 3 }, // TODO: verify cost
  prop_plane: { defId: 'prop_plane', name: '螺旋桨飞机', kind: 'joker', power: 4, cost: 4, singleUse: true }, // TODO: verify cost

  // --- Purple / action ---
  cartographer: { defId: 'cartographer', name: '制图师', kind: 'action', power: 0, cost: 3, ability: 'draw2' }, // TODO: verify cost
  scientist: { defId: 'scientist', name: '科学家', kind: 'action', power: 0, cost: 3, ability: 'draw1_remove1' }, // TODO: verify cost
  compass: { defId: 'compass', name: '指南针', kind: 'action', power: 0, cost: 2, ability: 'draw3', singleUse: true },
  travel_log: { defId: 'travel_log', name: '旅行日志', kind: 'action', power: 0, cost: 2, ability: 'draw2_remove2', singleUse: true }, // TODO: verify cost
  transmitter: { defId: 'transmitter', name: '发报机', kind: 'action', power: 0, cost: 4, ability: 'take_free', singleUse: true },
  native: { defId: 'native', name: '原住民向导', kind: 'action', power: 0, cost: 5, ability: 'native' },
};

/** The 18 buyable market types. */
export const MARKET_DEF_IDS: string[] = Object.values(CARD_DEFS)
  .filter((d) => !d.starting)
  .map((d) => d.defId);

/** The 6 def ids that start on the board (cheaper / introductory). */
export const STARTING_MARKET_SLOTS: string[] = [
  'scout',
  'trailblazer',
  'captain',
  'photographer',
  'journalist',
  'jack',
];

/** Copies of each market card type. */
export const MARKET_COPIES = 3;

/** Cards in each player's starting deck. */
export const STARTING_DECK: Array<{ defId: string; count: number }> = [
  { defId: 'explorer', count: 3 },
  { defId: 'traveller', count: 4 },
  { defId: 'sailor', count: 1 },
];

export const HAND_SIZE = 4;

export function getDef(defId: string): CardDef {
  const def = CARD_DEFS[defId];
  if (!def) throw new Error(`未知卡牌定义：${defId}`);
  return def;
}

/** Coin value of a card when used as currency to buy. */
export function coinValue(defId: string): number {
  const def = getDef(defId);
  // Coin (yellow) cards and jokers pay their full power; everything else is ½.
  if (def.kind === 'yellow' || def.kind === 'joker') return def.power;
  return 0.5;
}

/** Symbols a card can satisfy when moving. */
export function movableSymbols(defId: string): MoveSymbol[] {
  const def = getDef(defId);
  if (def.kind === 'joker') return ['machete', 'paddle', 'coin'];
  if (def.symbol) return [def.symbol];
  return [];
}

/** Build N concrete card instances of a def with unique ids. */
export function makeCards(defId: string, count: number, startIndex = 0): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ id: `${defId}#${startIndex + i}`, defId });
  }
  return out;
}
