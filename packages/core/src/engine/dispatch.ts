/**
 * engine/dispatch — the public entrypoint. `applyAction` clones state,
 * routes each Action through `dispatch`, and returns either the new state
 * with its events or the original state with an error. Imports from every
 * engine section.
 */
import type { GameState } from '../types.js';
import type { Action, ActionResult, GameEvent } from '../actions.js';
import { HAND_SIZE } from '../cards.js';
import { clone, fail, RuleError } from './helpers.js';
import { playMovementCard, stepTo, clearSpace, removeBlockade } from './movement.js';
import { promoteMarket, buyCard } from './buying.js';
import { discardCards } from './discard.js';
import { removeCards } from './hand.js';
import { useAbility } from './abilities.js';
import { playCaveToken } from './cave.js';
import { endTurn } from './turn.js';

/**
 * Apply a player action. Returns a NEW state plus a result. On any rule
 * violation the original state is returned unchanged with an error.
 */
export function applyAction(
  state: GameState,
  playerId: string,
  action: Action,
): { state: GameState; result: ActionResult } {
  if (state.phase !== 'playing') return fail(state, '游戏尚未开始');
  if (!state.turn || state.turn.playerId !== playerId) {
    return fail(state, '还没轮到你');
  }

  const next: GameState = clone(state);
  const events: GameEvent[] = [];
  try {
    dispatch(next, playerId, action, events);
    return { state: next, result: { ok: true, events } };
  } catch (e) {
    if (e instanceof RuleError) return fail(state, e.message);
    throw e;
  }
}

function dispatch(state: GameState, playerId: string, action: Action, events: GameEvent[]): void {
  if (state.turn?.pendingRemoval && action.type !== 'RemoveCards') {
    throw new RuleError('请先处理要移除的手牌');
  }
  if (state.turn?.pendingTrim && action.type !== 'DiscardCards') {
    throw new RuleError('先把手牌精简到 ' + HAND_SIZE + ' 张');
  }

  switch (action.type) {
    case 'PlayMovementCard':
      return playMovementCard(state, playerId, action.cardId, action.symbol, events);
    case 'StepTo':
      return stepTo(state, playerId, action.to, events);
    case 'ClearSpace':
      return clearSpace(state, playerId, action.to, action.cardIds, events);
    case 'PromoteMarket':
      return promoteMarket(state, playerId, action.defId, events);
    case 'BuyCard':
      return buyCard(state, playerId, action.defId, action.paymentCardIds, events);
    case 'RemoveBlockade':
      return removeBlockade(state, playerId, action, events);
    case 'DiscardCards':
      return discardCards(state, playerId, action.cardIds, events);
    case 'RemoveCards':
      return removeCards(state, playerId, action.cardIds, events);
    case 'UseAbility':
      return useAbility(state, playerId, action, events);
    case 'PlayCaveToken':
      return playCaveToken(state, playerId, action, events);
    case 'EndTurn':
      return endTurn(state, playerId, events);
  }
}