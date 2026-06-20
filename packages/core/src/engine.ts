import type {
  GameState,
  Player,
  Hex,
  Axial,
  MoveSymbol,
  Terrain,
  Card,
  Blockade,
} from './types.js';
import type { Action, GameEvent, ActionResult } from './actions.js';
import { getDef, coinValue, movableSymbols, HAND_SIZE } from './cards.js';
import { isAdjacent } from './hex.js';
import { shuffle } from './rng.js';

/** Deep-clone game state. GameState is plain JSON data, so this is exact. */
function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Symbol a movement card must match to enter a terrain (null = wildcard). */
function terrainSymbol(t: Terrain): MoveSymbol | null {
  switch (t) {
    case 'green':
      return 'machete';
    case 'blue':
      return 'paddle';
    case 'yellow':
      return 'coin';
    default:
      return null; // start / finish are wildcard; mountain/rubble/basecamp handled elsewhere
  }
}

function blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null {
  return terrainSymbol(blockade.terrain) ?? blockade.symbol ?? null;
}

function blockadeRequiresDiscard(blockade: Blockade): boolean {
  return blockade.terrain === 'rubble' || blockadeMoveSymbol(blockade) === null;
}

function symbolLabel(symbol: MoveSymbol): string {
  switch (symbol) {
    case 'machete':
      return '砍刀';
    case 'paddle':
      return '船桨';
    case 'coin':
      return '金币';
  }
}

class RuleError extends Error {}

function fail(state: GameState, error: string): { state: GameState; result: ActionResult } {
  return { state, result: { ok: false, error } };
}

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
  switch (action.type) {
    case 'PlayMovementCard':
      return playMovementCard(state, playerId, action.cardId, action.symbol, events);
    case 'StepTo':
      return stepTo(state, playerId, action.to, events);
    case 'ClearSpace':
      return clearSpace(state, playerId, action.to, action.cardIds, events);
    case 'BuyCard':
      return buyCard(state, playerId, action.defId, action.paymentCardIds, events);
    case 'RemoveBlockade':
      return removeBlockade(state, playerId, action.blockadeId, action.cardIds ?? [], events);
    case 'DiscardCards':
      return discardCards(state, playerId, action.cardIds, events);
    case 'UseAbility':
      return useAbility(state, playerId, action, events);
    case 'EndTurn':
      return endTurn(state, playerId, events);
  }
}

// --- helpers ---

function player(state: GameState, id: string): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new RuleError(`未知玩家：${id}`);
  return p;
}

function hexAt(state: GameState, c: Axial): Hex | undefined {
  return state.hexes.find((h) => h.q === c.q && h.r === c.r);
}

function sameCoord(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

function crossesBlockadeEdge(blockade: Blockade, from: Axial, to: Axial): boolean {
  const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  return edges.some(
    (edge) =>
      (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
  );
}

function blockadeBetween(state: GameState, from: Axial, to: Axial): Blockade | undefined {
  return state.blockades.find((b) => crossesBlockadeEdge(b, from, to));
}

function claimBlockade(p: Player, blockade: Blockade | undefined, events: GameEvent[]): void {
  if (!blockade || blockade.claimedBy) return;
  blockade.claimedBy = p.id;
  p.claimedBlockades ??= [];
  if (!p.claimedBlockades.includes(blockade.id)) p.claimedBlockades.push(blockade.id);
  p.blockades = p.claimedBlockades.length;
  events.push({ type: 'blockadeClaimed', playerId: p.id, blockadeId: blockade.id });
}

function blockadeRequirementLabel(blockade: Blockade): string {
  const symbol = blockadeMoveSymbol(blockade);
  return symbol ? `${symbolLabel(symbol)} ${blockade.cost} 点` : `弃 ${blockade.cost} 张手牌`;
}

function takeFromHand(p: Player, cardId: string): Card {
  const idx = p.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new RuleError(`这张牌不在手牌中：${cardId}`);
  return p.hand.splice(idx, 1)[0];
}

// --- movement ---

function playMovementCard(
  state: GameState,
  playerId: string,
  cardId: string,
  symbol: MoveSymbol,
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  const card = p.hand.find((c) => c.id === cardId);
  if (!card) throw new RuleError('这张牌不在手牌中');
  const symbols = movableSymbols(card.defId);
  if (!symbols.includes(symbol)) {
    throw new RuleError(`这张牌不能当作${symbolLabel(symbol)}使用`);
  }
  const def = getDef(card.defId);
  takeFromHand(p, cardId);
  turn.inPlay.push(card);
  turn.activeMover = { cardId, symbol, remaining: def.power };
  events.push({ type: 'cardPlayed', playerId, cardId });
}

function moveTo(state: GameState, p: Player, to: Hex, events: GameEvent[]): void {
  const from = hexAt(state, p.position);
  if (from) from.occupant = undefined;
  to.occupant = p.id;
  p.position = { q: to.q, r: to.r };
  events.push({ type: 'movedTo', playerId: p.id, to: { q: to.q, r: to.r } });

  const classicTerminal = to.terrain === 'eldorado';
  const legacyTerminal = to.terrain === 'finish' && !state.hexes.some((h) => h.terrain === 'eldorado');
  if (classicTerminal || legacyTerminal) {
    p.finished = true;
    p.finishedAt = state.turnNumber;
    to.occupant = undefined; // El Dorado itself is not blocked
    events.push({ type: 'reachedEldorado', playerId: p.id });
    if (state.finalTurnsRemaining === null) {
      state.finalRoundTriggeredBy = p.id;
      state.finalTurnsRemaining = finalTurnsAfter(state, p.id);
    }
  }
}

function finalTurnsAfter(state: GameState, playerId: string): number {
  const idx = state.turnOrder.indexOf(playerId);
  if (idx === -1) return 0;
  return state.turnOrder.slice(idx + 1).filter((id) => !player(state, id).finished).length;
}

function assertEnterable(state: GameState, p: Player, to: Hex): void {
  if (to.terrain === 'mountain') throw new RuleError('不能进入山地');
  const from = hexAt(state, p.position);
  if (to.terrain === 'eldorado' && from?.terrain !== 'finish') {
    throw new RuleError('必须先进入黄金城入口，才能进入黄金城');
  }
  if (to.occupant && to.occupant !== p.id) throw new RuleError('该地格已被占用');
  if (!isAdjacent(p.position, to)) throw new RuleError('只能移动到相邻地格');
}

function stepTo(state: GameState, playerId: string, to: Axial, events: GameEvent[]): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  const mover = turn.activeMover;
  if (!mover || mover.remaining <= 0) throw new RuleError('没有可用的移动牌');
  const hex = hexAt(state, to);
  if (!hex) throw new RuleError('没有这个地格');
  assertEnterable(state, p, hex);

  if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') {
    throw new RuleError('需要弃牌清除此格后才能进入');
  }

  // The destination hex's own terrain requirement (symbol + cost).
  let destRequired: MoveSymbol | null;
  let destDeduct: number;
  if (hex.terrain === 'eldorado') {
    destRequired = null;
    destDeduct = 1;
  } else if (hex.terrain === 'finish') {
    destRequired = hex.reqSymbol ?? null;
    destDeduct = Math.max(hex.cost, 1);
  } else if (hex.terrain === 'start') {
    destRequired = null;
    destDeduct = 1;
  } else {
    destRequired = terrainSymbol(hex.terrain);
    destDeduct = hex.cost;
  }

  // Crossing an unclaimed seam pays the blockade AND enters the destination
  // terrain in one move: the cost is the seam cost plus the terrain cost, and
  // because a single mover carries one symbol, that symbol must satisfy both —
  // so the destination terrain must accept the seam's symbol (or be wildcard).
  // The first player to pay claims the marker; once claimed the seam is open
  // and later crossings pay only the normal destination terrain.
  const blockade = blockadeBetween(state, p.position, hex);
  let required: MoveSymbol | null;
  let deduct: number;
  if (blockade && !blockade.claimedBy) {
    const blockSym = blockadeMoveSymbol(blockade);
    // Discard-type seams (rubble / no symbol) cannot be crossed with a movement
    // card — they are paid via ClearSpace.
    if (blockSym === null) {
      throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能通过连接地形`);
    }
    if (destRequired !== null && destRequired !== blockSym) {
      throw new RuleError(
        `跨越连接地形需要${symbolLabel(blockSym)}，无法用它进入对岸的${symbolLabel(destRequired)}地形`,
      );
    }
    required = blockSym;
    deduct = blockade.cost + destDeduct;
  } else {
    required = destRequired;
    deduct = destDeduct;
  }
  if (required !== null && required !== mover.symbol) {
    throw new RuleError(`需要${symbolLabel(required)}才能进入`);
  }
  if (mover.remaining < deduct) throw new RuleError('移动力量不足');

  mover.remaining -= deduct;
  claimBlockade(p, blockade, events);
  moveTo(state, p, hex, events);
}

function clearSpace(
  state: GameState,
  playerId: string,
  to: Axial,
  cardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const hex = hexAt(state, to);
  if (!hex) throw new RuleError('没有这个地格');
  const blockade = blockadeBetween(state, p.position, hex);
  if (blockade && !blockade.claimedBy) {
    if (!blockadeRequiresDiscard(blockade)) {
      throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能通过连接地形`);
    }
    assertEnterable(state, p, hex);
    if (cardIds.length !== blockade.cost) {
      throw new RuleError(`需要正好选择 ${blockade.cost} 张牌`);
    }
    for (const id of cardIds) {
      p.discard.push(takeFromHand(p, id));
    }
    state.turn!.activeMover = undefined;
    claimBlockade(p, blockade, events);
    moveTo(state, p, hex, events);
    events.push({ type: 'spaceCleared', playerId, to: { q: to.q, r: to.r }, removed: false });
    return;
  }
  if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp') {
    throw new RuleError('这个地格不能被清除');
  }
  assertEnterable(state, p, hex);
  if (cardIds.length !== hex.cost) {
    throw new RuleError(`需要正好选择 ${hex.cost} 张牌`);
  }
  const removed = hex.terrain === 'basecamp';
  for (const id of cardIds) {
    const card = takeFromHand(p, id);
    if (removed) p.removed.push(card);
    else p.discard.push(card);
  }
  // Clearing ends any active movement card's run.
  state.turn!.activeMover = undefined;
  moveTo(state, p, hex, events);
  events.push({ type: 'spaceCleared', playerId, to: { q: to.q, r: to.r }, removed });
}

function removeBlockade(
  state: GameState,
  playerId: string,
  blockadeId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const blockade = state.blockades.find((b) => b.id === blockadeId);
  if (!blockade) throw new RuleError('没有这个连接地形');
  if (blockade.claimedBy) throw new RuleError('这块连接地形已经打开');
  // The player must be standing beside one of this seam's covered edges.
  const beside = blockade.edges.some(
    (e) => sameCoord(e.a, p.position) || sameCoord(e.b, p.position),
  );
  if (!beside) throw new RuleError('当前棋子不在这块连接地形旁边');

  if (blockadeRequiresDiscard(blockade)) {
    if (cardIds.length !== blockade.cost) {
      throw new RuleError(`需要正好选择 ${blockade.cost} 张牌`);
    }
    for (const id of cardIds) p.discard.push(takeFromHand(p, id));
    claimBlockade(p, blockade, events);
    return; // 留在原地，不动 activeMover
  }

  const sym = blockadeMoveSymbol(blockade);
  const mover = state.turn!.activeMover;
  if (!mover || sym === null || mover.symbol !== sym || mover.remaining < blockade.cost) {
    throw new RuleError(`需要${blockadeRequirementLabel(blockade)}才能移除连接地形`);
  }
  mover.remaining -= blockade.cost; // 只扣障碍 cost，剩余力量保留
  claimBlockade(p, blockade, events);
  // 留在原地。
}

// --- buying ---

function freeOnBoardSlot(state: GameState): boolean {
  const onBoard = state.market.filter((m) => m.onBoard);
  return onBoard.some((m) => m.count === 0) || onBoard.length < 6;
}

function promoteOffBoard(state: GameState): void {
  const pile = state.market.find((m) => !m.onBoard && m.count > 0);
  if (pile) pile.onBoard = true;
}

function buyCard(
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
  if (!pile.onBoard && !freeOnBoardSlot(state)) {
    throw new RuleError('这张牌还没有进入市场');
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
  p.discard.push(mintCard(p, defId));
  pile.count -= 1;
  if (pile.count === 0 && pile.onBoard) {
    pile.onBoard = false;
    promoteOffBoard(state);
  }
  turn.hasBought = true;
  events.push({ type: 'bought', playerId, defId });
}

/** Mint a new owned card instance with a unique id but a clean defId. */
function mintCard(p: Player, defId: string): Card {
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

// --- discard skill ---

function discardCards(
  state: GameState,
  playerId: string,
  cardIds: string[],
  events: GameEvent[],
): void {
  if (cardIds.length === 0) throw new RuleError('至少选择一张牌弃置');
  const p = player(state, playerId);
  const turn = state.turn!;
  if (turn.hasDiscarded) throw new RuleError('本回合已经弃过牌');
  for (const id of cardIds) {
    p.discard.push(takeFromHand(p, id));
  }
  turn.hasDiscarded = true;
  events.push({ type: 'discarded', playerId, count: cardIds.length });
}

// --- ability cards ---

function drawInto(state: GameState, p: Player, count: number): number {
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      const [shuffled, s] = shuffle(p.discard, state.rngState);
      state.rngState = s;
      p.deck = shuffled;
      p.discard = [];
    }
    const c = p.deck.shift();
    if (c) {
      p.hand.push(c);
      drawn++;
    }
  }
  return drawn;
}

function useAbility(
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
      drawInto(state, p, 1);
      removeFromHand(p, turn, action.removeCardIds ?? [], 1);
      events.push({ type: 'drew', playerId, count: 1 });
      break;
    }
    case 'draw2_remove2': {
      drawInto(state, p, 2);
      removeFromHand(p, turn, action.removeCardIds ?? [], 2);
      events.push({ type: 'drew', playerId, count: 2 });
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
        promoteOffBoard(state);
      }
      break;
    }
    case 'native': {
      if (!action.nativeTo) throw new RuleError('没有选择目标地格');
      const hex = hexAt(state, action.nativeTo);
      if (!hex) throw new RuleError('没有这个地格');
      assertEnterable(state, p, hex); // ignores terrain cost/symbol, but not mountain/occupied
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

function removeFromHand(p: Player, turn: GameState['turn'], cardIds: string[], max: number): void {
  if (cardIds.length > max) throw new RuleError(`最多只能移除 ${max} 张牌`);
  for (const id of cardIds) {
    const card = takeFromHand(p, id);
    turn!.removedThisTurn.push(card);
  }
}

// --- end of turn ---

function endTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const p = player(state, playerId);
  const turn = state.turn!;

  // Resolve cards played this turn.
  for (const card of turn.inPlay) {
    if (getDef(card.defId).singleUse) p.removed.push(card);
    else p.discard.push(card);
  }
  for (const card of turn.removedThisTurn) p.removed.push(card);

  // Draw back up to hand size.
  const need = HAND_SIZE - p.hand.length;
  if (need > 0) {
    const drawn = drawInto(state, p, need);
    if (drawn > 0) events.push({ type: 'drew', playerId, count: drawn });
  }

  advanceTurn(state, events);
}

function advanceTurn(state: GameState, events: GameEvent[]): void {
  // End the game if the final round is exhausted.
  if (state.finalTurnsRemaining !== null && state.finalTurnsRemaining <= 0) {
    return endGame(state, events);
  }

  const n = state.turnOrder.length;
  for (let k = 1; k <= n; k++) {
    const idx = (state.currentPlayerIdx + k) % n;
    const candId = state.turnOrder[idx];
    if (player(state, candId).finished) continue;
    state.currentPlayerIdx = idx;
    state.turnNumber += 1;
    if (state.finalTurnsRemaining !== null) state.finalTurnsRemaining -= 1;
    state.turn = {
      playerId: candId,
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
      hasDiscarded: false,
    };
    events.push({ type: 'turnStarted', playerId: candId });
    return;
  }
  // No unfinished players remain.
  endGame(state, events);
}

function endGame(state: GameState, events: GameEvent[]): void {
  state.phase = 'finished';
  state.turn = null;
  const finished = state.players.filter((p) => p.finished);
  finished.sort((a, b) => {
    if (b.blockades !== a.blockades) return b.blockades - a.blockades;
    return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
  });
  state.winnerId = finished[0]?.id ?? null;
  events.push({ type: 'gameOver', winnerId: state.winnerId });
}
