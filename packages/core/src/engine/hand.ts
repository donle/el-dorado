/**
 * engine/hand — handles RemoveCards (the only path that moves hand cards
 * onto `removedThisTurn` to be permanently retired). Kept tiny so other
 * sections can import it without forming cycles.
 */
import type { GameState, Player } from '../types.js';
import type { GameEvent } from '../actions.js';
import { player, RuleError, takeFromHand } from './helpers.js';

function removeFromHand(
  p: Player,
  turn: NonNullable<GameState['turn']>,
  cardIds: string[],
  max: number,
): void {
  if (cardIds.length > max) throw new RuleError(`最多只能移除 ${max} 张牌`);
  for (const id of cardIds) {
    const card = takeFromHand(p, id);
    turn.removedThisTurn.push(card);
  }
}

export function removeCards(
  state: GameState,
  playerId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  const pending = turn.pendingRemoval;
  if (!pending) throw new RuleError('当前没有需要移除的手牌');
  removeFromHand(p, turn, cardIds, pending.max);
  turn.pendingRemoval = undefined;
  events.push({ type: 'removedCards', playerId, count: cardIds.length });
}