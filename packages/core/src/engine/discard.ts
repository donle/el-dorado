/**
 * engine/discard — handles DiscardCards (free discard + pendingTrim resolve).
 * The auto-discard safety net for AI/offline players lives in turn.ts since
 * only `endTurn` triggers it; keeping it there avoids a discard ↔ turn cycle.
 */
import type { GameState } from '../types.js';
import type { GameEvent } from '../actions.js';
import { HAND_SIZE } from '../cards.js';
import { drawInto, player, RuleError, takeFromHand } from './helpers.js';
import { advanceTurn } from './turn.js';

export function discardCards(
  state: GameState,
  playerId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  if (cardIds.length === 0) throw new RuleError('至少选择一张牌弃置');
  const p = player(state, playerId);
  const turn = state.turn!;
  for (const id of cardIds) {
    p.discard.push(takeFromHand(p, id));
  }
  turn.hasDiscarded = true;
  events.push({ type: 'discarded', playerId, count: cardIds.length });

  // Resolve pendingTrim once hand is back at/under cap: draw up to HAND_SIZE
  // and let turn.ts advance to the next player.
  if (state.turn?.pendingTrim) {
    if (p.hand.length <= state.turn.pendingTrim.max) {
      state.turn.pendingTrim = undefined;
      const need = HAND_SIZE - p.hand.length;
      if (need > 0) {
        const drawn = drawInto(state, p, need);
        if (drawn > 0) events.push({ type: 'drew', playerId, count: drawn });
      }
      advanceTurn(state, events);
    }
    // else: still > max, pendingTrim remains, await next DiscardCards
  }
}