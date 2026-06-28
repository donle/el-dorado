/**
 * engine/cave — handles `PlayCaveToken`. Pure over the cloned state,
 * mutates it in place and pushes events to the caller's accumulator.
 *
 * Eight token kinds, routed by the token's `kind` field:
 *
 *   move_<sym>_<n>   play as a movement card (uses symbol from token def)
 *   draw_play        draw 1 and play it immediately (Cartographer-style)
 *   remove_hand      permanently remove one hand card
 *   swap_hand        exchange 1–4 hand cards for the same number drawn
 *   preserve_item    send a single-use action card to discard instead of
 *                    removed (must be armed before the action is used)
 *   pass_through     for the rest of the turn, can pass through/onto
 *                    occupied hexes (mountains still block)
 *   native           move to an adjacent hex ignoring requirements
 *   symbol_swap      change the symbol of the next movement card played
 */
import type { Action, GameEvent, PlayCaveTokenData } from '../actions.js';
import type { Axial, GameState, MoveSymbol, Player, TurnState } from '../types.js';
import { getDef } from '../cards.js';
import { CAVE_TOKEN_DEFS as _CAVE_TOKEN_DEFS, getCaveToken } from '../cave.js';
void _CAVE_TOKEN_DEFS;
import {
  blockadeBetween,
  blockadeRequirementLabel,
  claimBlockade,
  drawInto,
  hexAt,
  player,
  RuleError,
  takeFromHand,
} from './helpers.js';
import { assertEnterable, moveTo } from './movement.js';
import { mintCard } from './buying.js';
import { isAdjacent } from '../hex.js';

export function playCaveToken(
  state: GameState,
  playerId: string,
  action: Extract<Action, { type: 'PlayCaveToken' }>,
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const idx = p.caveTokens.indexOf(action.tokenId);
  if (idx === -1) throw new RuleError('这个洞穴指示物不在你的库存里');
  const def = getCaveToken(action.tokenId);

  // Burn the token up-front. Effects that fail mid-way still consume
  // the token — matches the official rule (tokens are removed after
  // use regardless of subsequent outcome).
  p.caveTokens.splice(idx, 1);

  switch (action.data.kind) {
    case 'move':
      return applyMoveToken(state, p, def, action.data, events);
    case 'buy':
      return applyBuyToken(state, p, def, action.data.defId, action.data.paymentCardIds, events);
    case 'draw_play':
      return applyDrawPlayToken(state, p, events);
    case 'remove_hand':
      return applyRemoveHandToken(state, p, action.data.cardId, events);
    case 'swap_hand':
      return applySwapHandToken(state, p, action.data.cardIds, events);
    case 'preserve_item':
      return applyPreserveItem(state, p, events);
    case 'pass_through':
      return applyPassThrough(state, p, events);
    case 'native':
      return applyNativeToken(state, p, action.data.to, events);
    case 'symbol_swap':
      return applySymbolSwapToken(state, p, def, action.data, events);
    default:
      throw new RuleError('这个洞穴效果尚未实现');
  }
}

function applyMoveToken(
  state: GameState,
  p: Player,
  def: ReturnType<typeof getCaveToken>,
  data: Extract<PlayCaveTokenData, { kind: 'move' }>,
  events: GameEvent[],
): void {
  // Cave token: e.g. `move_machete_2` plays as a machete-2 card.
  if (def.symbol !== data.symbol) {
    throw new RuleError(`这个洞穴指示物是${def.name}，需要以${def.name}打出`);
  }
  const turn = state.turn!;
  // Convert the token into an activeMover with the token's power. The
  // `fromCave` flag lets the engine distinguish a token-played move from
  // a hand-card move (e.g. for `symbol_swap` interactions).
  const mover: NonNullable<TurnState['activeMover']> = {
    cardId: def.id,
    symbol: def.symbol!,
    remaining: def.power,
    fromCave: true,
  };
  turn.activeMover = mover;
  events.push({ type: 'cardPlayed', playerId: p.id, cardId: def.id });

  const to = hexAt(state, data.to);
  if (!to) throw new RuleError('没有这个地格');
  if (!isAdjacent(p.position, to)) throw new RuleError('只能移动到相邻地格');
  assertEnterable(state, p, to, { allowOccupied: turn.passThroughActive === true });
  validateStep(to, def.symbol!, def.power);
  deductStep(to, def.symbol!, mover);
  const blockade = blockadeBetween(state, p.position, to);
  claimBlockade(p, blockade, events);
  moveTo(state, p, to, events);
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: def.id });
}

function applyBuyToken(
  state: GameState,
  p: Player,
  def: ReturnType<typeof getCaveToken>,
  defId: string,
  paymentCardIds: string[],
  events: GameEvent[],
): void {
  if (def.symbol !== 'coin') {
    throw new RuleError('只有金币洞穴指示物可以用来购买');
  }
  if (state.turn!.hasBought) {
    throw new RuleError('本回合已经购买过一张牌');
  }
  const pile = state.market.find((m) => m.defId === defId);
  if (!pile || pile.count <= 0) throw new RuleError('这张牌当前无法购买');
  const targetDef = getDef(defId);
  if (targetDef.cost <= 0) throw new RuleError('这张牌不能购买');
  // Cave coin tokens have power 1/2/3; they pay like a coin card of that
  // power. Combine with the chosen payment cards to reach the cost.
  let paid = def.power;
  for (const id of paymentCardIds) {
    const card = p.hand.find((c) => c.id === id);
    if (!card) throw new RuleError('付款牌不在手牌中');
    const cdef = getDef(card.defId);
    if (cdef.kind === 'yellow' || cdef.kind === 'joker') paid += cdef.power;
    else paid += 0.5;
  }
  if (paid < targetDef.cost) throw new RuleError('付款不足');
  for (const id of paymentCardIds) {
    const card = takeFromHand(p, id);
    p.discard.push(card);
  }
  p.discard.push(mintCard(p, defId));
  pile.count -= 1;
  if (pile.count === 0 && pile.onBoard) pile.onBoard = false;
  state.turn!.hasBought = true;
  events.push({ type: 'bought', playerId: p.id, defId });
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: def.id });
}

function applyDrawPlayToken(_state: GameState, p: Player, events: GameEvent[]): void {
  // Cartographer-style: draw 1 from the deck and play it this turn.
  // The drawn card lands in hand; the player still has to play it like
  // any other card. The end-of-turn check forces any unplayed card to
  // be discarded if `drawPlayTokenActive` is still set.
  const drawn = drawInto(_state, p, 1);
  events.push({ type: 'drew', playerId: p.id, count: drawn });
  _state.turn!.drawPlayTokenActive = true;
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'draw_play' });
}

function applyRemoveHandToken(state: GameState, p: Player, cardId: string, events: GameEvent[]): void {
  const card = takeFromHand(p, cardId);
  p.removed.push(card);
  state.turn!.removedThisTurn.push(card);
  events.push({ type: 'removedCards', playerId: p.id, count: 1 });
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'remove_hand' });
}

function applySwapHandToken(
  state: GameState,
  p: Player,
  cardIds: string[],
  events: GameEvent[],
): void {
  if (cardIds.length < 1 || cardIds.length > 4) {
    throw new RuleError('替换手牌数必须在 1 到 4 之间');
  }
  for (const id of cardIds) {
    const card = takeFromHand(p, id);
    p.discard.push(card);
  }
  const drawn = drawInto(state, p, cardIds.length);
  events.push({ type: 'drew', playerId: p.id, count: drawn });
  events.push({ type: 'discarded', playerId: p.id, count: cardIds.length });
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'swap_hand' });
}

function applyPreserveItem(state: GameState, p: Player, events: GameEvent[]): void {
  // Arms the turn flag: the next single-use action card played this turn
  // is sent to `p.discard` instead of `p.removed`. The dispatch layer in
  // `endTurn` reads `state.turn.preserveItemActive` to make that decision.
  void p;
  state.turn!.preserveItemActive = true;
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'preserve_item' });
}

function applyPassThrough(state: GameState, p: Player, events: GameEvent[]): void {
  // Allow passing through/onto occupied hexes for the rest of the turn.
  // Mountains still block; El Dorado entrance rules still apply.
  void p;
  state.turn!.passThroughActive = true;
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'pass_through' });
}

function applyNativeToken(state: GameState, p: Player, to: Axial, events: GameEvent[]): void {
  const hex = hexAt(state, to);
  if (!hex) throw new RuleError('没有这个地格');
  // Native guide semantics: may enter mountain, ignores cost/symbol.
  // Occupancy and El Dorado entrance rules still apply.
  assertEnterable(state, p, hex, {
    allowMountain: true,
    allowOccupied: state.turn?.passThroughActive === true,
  });
  const blockade = blockadeBetween(state, p.position, hex);
  if (blockade && !blockade.claimedBy) {
    throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能通过连接地形`);
  }
  claimBlockade(p, blockade, events);
  moveTo(state, p, hex, events);
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'native' });
}

function applySymbolSwapToken(
  state: GameState,
  p: Player,
  def: ReturnType<typeof getCaveToken>,
  data: Extract<PlayCaveTokenData, { kind: 'symbol_swap' }>,
  events: GameEvent[],
): void {
  // Stores the chosen symbol; the next movement card played this turn
  // is treated as having this symbol instead of its own.
  void p;
  void def;
  state.turn!.symbolSwap = data.symbol;
  events.push({ type: 'caveTokenUsed', playerId: p.id, tokenId: 'symbol_swap' });
}

function validateStep(
  to: NonNullable<ReturnType<typeof hexAt>>,
  symbol: MoveSymbol,
  power: number,
): void {
  if (to.terrain === 'mountain') throw new RuleError('不能进入山地');
  if (to.terrain === 'eldorado' || to.terrain === 'rubble' || to.terrain === 'basecamp') {
    throw new RuleError('该地格需要其他动作类型');
  }
  if (to.terrain === 'start') {
    if (power < 1) throw new RuleError('移动力量不足');
    return;
  }
  if (to.terrain === 'finish') {
    const required = to.reqSymbol ?? null;
    if (required !== null && required !== symbol) throw new RuleError('符号不匹配');
    const cost = Math.max(to.cost, 1);
    if (power < cost) throw new RuleError('移动力量不足');
    return;
  }
  const required = to.reqSymbol ?? null;
  if (required !== null && required !== symbol) {
    throw new RuleError('符号不匹配');
  }
  if (power < to.cost) throw new RuleError('移动力量不足');
}

function deductStep(
  to: NonNullable<ReturnType<typeof hexAt>>,
  symbol: MoveSymbol,
  mover: NonNullable<TurnState['activeMover']>,
): void {
  void symbol;
  let cost = to.cost;
  if (to.terrain === 'finish') cost = Math.max(to.cost, 1);
  if (to.terrain === 'start') cost = 1;
  mover.remaining -= cost;
}
