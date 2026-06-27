/**
 * engine/abilities — handles UseAbility. Plays an action card from hand,
 * routes its `def.ability` to the matching effect (draw / native / take_free /
 * draw-X-remove-X), and pushes the appropriate events. Imports from
 * helpers, movement, buying, and hand.
 */
import type { Action, GameEvent } from '../actions.js';
import type { GameState } from '../types.js';
import { getDef } from '../cards.js';
import {
  blockadeBetween,
  blockadeRequirementLabel,
  drawInto,
  hexAt,
  player,
  RuleError,
  takeFromHand,
} from './helpers.js';
import { assertEnterable, moveTo } from './movement.js';
import { mintCard } from './buying.js';
import { removeCards } from './hand.js';

export function useAbility(
  state: GameState,
  playerId: string,
  action: Extract<Action, { type: 'UseAbility' }>,
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  const card = takeFromHand(p, action.cardId);
  const def = getDef(card.defId);
  if (def.kind !== 'action') throw new RuleError('这不是行动牌');

  // The card itself leaves the hand: single-use → removed, else → discard later.
  if (def.singleUse) turn.removedThisTurn.push(card);
  else turn.inPlay.push(card);

  switch (def.ability) {
    case 'draw2':
      events.push({ type: 'drew', playerId, count: drawInto(state, p, 2) });
      break;
    case 'draw3':
      events.push({ type: 'drew', playerId, count: drawInto(state, p, 3) });
      break;
    case 'draw1_remove1': {
      const drawn = drawInto(state, p, 1);
      turn.pendingRemoval = { sourceCardId: action.cardId, max: 1 };
      events.push({ type: 'drew', playerId, count: drawn });
      if (action.removeCardIds) removeCards(state, playerId, action.removeCardIds, events);
      break;
    }
    case 'draw2_remove2': {
      const drawn = drawInto(state, p, 2);
      turn.pendingRemoval = { sourceCardId: action.cardId, max: 2 };
      events.push({ type: 'drew', playerId, count: drawn });
      if (action.removeCardIds) removeCards(state, playerId, action.removeCardIds, events);
      break;
    }
    case 'take_free': {
      const defId = action.takeDefId;
      if (!defId) throw new RuleError('没有选择卡牌');
      const pile = state.market.find((m) => m.defId === defId);
      if (!pile || pile.count <= 0) throw new RuleError('这张牌当前无法购买');
      p.discard.push(mintCard(p, defId));
      pile.count -= 1;
      if (pile.count === 0 && pile.onBoard) {
        pile.onBoard = false;
      }
      break;
    }
    case 'native': {
      if (!action.nativeTo) throw new RuleError('没有选择目标地格');
      const hex = hexAt(state, action.nativeTo);
      if (!hex) throw new RuleError('没有这个地格');
      assertEnterable(state, p, hex, { allowMountain: true }); // ignores terrain cost/symbol, but not occupancy/route gates
      const blockade = blockadeBetween(state, p.position, hex);
      if (blockade && !blockade.claimedBy) {
        throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能通过连接地形`);
      }
      moveTo(state, p, hex, events);
      break;
    }
    default:
      throw new RuleError('这个行动能力尚未实现');
  }
  events.push({ type: 'ability', playerId, cardId: action.cardId });
}