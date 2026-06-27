/**
 * engine/buying — handles PromoteMarket / BuyCard. Owns the
 * `MARKET_SLOTS` cap and the `mintCard` helper that produces unique
 * player-owned card instances. Imports only from helpers + cards.
 */
import type { Card, GameState, Player } from '../types.js';
import type { GameEvent } from '../actions.js';
import { coinValue, getDef } from '../cards.js';
import { player, RuleError, takeFromHand } from './helpers.js';

const MARKET_SLOTS = 6;

function onBoardMarketCount(state: GameState): number {
  return state.market.filter((m) => m.onBoard && m.count > 0).length;
}

function hasMarketVacancy(state: GameState): boolean {
  return onBoardMarketCount(state) < MARKET_SLOTS && state.market.some((m) => !m.onBoard && m.count > 0);
}

export function promoteMarket(
  state: GameState,
  playerId: string,
  defId: string,
  events: GameEvent[],
): void {
  const turn = state.turn!;
  if (turn.hasBought) throw new RuleError('购买后不能补位，由下一位玩家选择候补市场');
  if (!hasMarketVacancy(state)) throw new RuleError('当前市场没有需要补位的空栏');

  const pile = state.market.find((m) => m.defId === defId);
  if (!pile || pile.count <= 0 || pile.onBoard) {
    throw new RuleError('只能从候补市场选择仍有库存的卡牌');
  }

  pile.onBoard = true;
  events.push({ type: 'marketPromoted', playerId, defId });
}

export function buyCard(
  state: GameState,
  playerId: string,
  defId: string,
  paymentCardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  if (turn.hasBought) throw new RuleError('本回合已经购买过卡牌');

  const pile = state.market.find((m) => m.defId === defId);
  if (!pile || pile.count <= 0) throw new RuleError('这张牌当前无法购买');
  if (!pile.onBoard) {
    throw new RuleError('这张牌还没有进入市场，请先将候补牌放入市场');
  }

  const cost = getDef(defId).cost;
  let power = 0;
  const cards: Card[] = [];
  for (const id of paymentCardIds) {
    const card = p.hand.find((c) => c.id === id);
    if (!card) throw new RuleError(`支付用的牌不在手牌中：${id}`);
    power += coinValue(card.defId);
    cards.push(card);
  }
  if (power < cost) throw new RuleError(`金币不足：需要 ${cost}，当前 ${power}`);

  // Spend the payment cards (to discard) and the new card (to discard).
  for (const card of cards) {
    takeFromHand(p, card.id);
    p.discard.push(card);
  }
  const bought = mintCard(p, defId);
  // Cartographer's card text allows it to be played immediately after purchase.
  if (defId === 'cartographer') p.hand.push(bought);
  else p.discard.push(bought);
  pile.count -= 1;
  if (pile.count === 0 && pile.onBoard) {
    pile.onBoard = false;
  }
  turn.hasBought = true;
  events.push({ type: 'bought', playerId, defId });
}

/** Mint a new owned card instance with a unique id but a clean defId. */
export function mintCard(p: Player, defId: string): Card {
  const all = [...p.deck, ...p.hand, ...p.discard, ...p.removed];
  const prefix = `${p.id}:${defId}#`;
  let max = -1;
  for (const c of all) {
    if (c.id.startsWith(prefix)) {
      const n = Number(c.id.slice(prefix.length));
      if (n > max) max = n;
    }
  }
  return { id: `${prefix}${max + 1}`, defId };
}