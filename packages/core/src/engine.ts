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
  if (state.turn?.pendingRemoval && action.type !== 'RemoveCards') {
    throw new RuleError('请先处理要移除的手牌');
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

function isFinishEntrance(hex: Hex | undefined): boolean {
  return !!hex && (hex.finishEntrance === true || hex.terrain === 'finish');
}

function finalTurnsAfter(state: GameState, playerId: string): number {
  const idx = state.turnOrder.indexOf(playerId);
  if (idx === -1) return 0;
  return state.turnOrder.slice(idx + 1).filter((id) => !player(state, id).finished).length;
}

function assertEnterable(
  state: GameState,
  p: Player,
  to: Hex,
  opts: { allowMountain?: boolean } = {},
): void {
  if (to.terrain === 'mountain' && !opts.allowMountain) throw new RuleError('不能进入山地');
  const from = hexAt(state, p.position);
  if (to.terrain === 'eldorado' && !isFinishEntrance(from)) {
    throw new RuleError('必须先进入黄金城入口，才能进入黄金城');
  }
  if (to.occupant && to.occupant !== p.id) throw new RuleError('该地格已被占用');
  if (!isAdjacent(p.position, to)) throw new RuleError('只能移动到相邻地格');
}

function stepTo(state: GameState, playerId: string, to: Axial, events: GameEvent[]): void {
  const p = player(state, playerId);
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
    destDeduct = 0;
  } else if (hex.terrain === 'finish') {
    destRequired = hex.reqSymbol ?? null;
    destDeduct = Math.max(hex.cost, 1);
  } else if (hex.reqSymbol) {
    destRequired = hex.reqSymbol;
    destDeduct = Math.max(hex.cost, 1);
  } else if (hex.terrain === 'start') {
    destRequired = null;
    destDeduct = 1;
  } else {
    destRequired = terrainSymbol(hex.terrain);
    destDeduct = hex.cost;
  }

  // An unclaimed seam must be removed first via RemoveBlockade (a separate
  // action that claims the marker in place). Stepping is then a normal move
  // that pays only the destination terrain. Once claimed the seam is open, so
  // claimBlockade below is a no-op for an already-claimed (or absent) seam.
  const blockade = blockadeBetween(state, p.position, hex);
  if (blockade && !blockade.claimedBy) {
    throw new RuleError('需要先移除连接地形障碍');
  }
  if (hex.terrain === 'eldorado') {
    claimBlockade(p, blockade, events);
    moveTo(state, p, hex, events);
    return;
  }
  const turn = state.turn!;
  const mover = turn.activeMover;
  if (!mover || mover.remaining <= 0) throw new RuleError('没有可用的移动牌');
  const required = destRequired;
  const deduct = destDeduct;
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
  action: Extract<Action, { type: 'RemoveBlockade' }>,
  events: GameEvent[],
): void {
  const { blockadeId, cardIds = [], cardId, symbol } = action;
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
    if (cardId || symbol) throw new RuleError('这块连接地形需要弃牌移除');
    if (cardIds.length !== blockade.cost) {
      throw new RuleError(`需要正好选择 ${blockade.cost} 张牌`);
    }
    for (const id of cardIds) p.discard.push(takeFromHand(p, id));
    claimBlockade(p, blockade, events);
    return; // 留在原地，不动 activeMover
  }

  if (cardId || symbol) {
    if (!cardId || !symbol) throw new RuleError('需要选择一张移动牌');
    playMovementCard(state, playerId, cardId, symbol, events);
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

const MARKET_SLOTS = 6;

function onBoardMarketCount(state: GameState): number {
  return state.market.filter((m) => m.onBoard && m.count > 0).length;
}

function hasMarketVacancy(state: GameState): boolean {
  return onBoardMarketCount(state) < MARKET_SLOTS && state.market.some((m) => !m.onBoard && m.count > 0);
}

function promoteMarket(
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
  for (const id of cardIds) {
    p.discard.push(takeFromHand(p, id));
  }
  turn.hasDiscarded = true;
  events.push({ type: 'discarded', playerId, count: cardIds.length });
}

function removeCards(
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

  // Hand-cap trim check: if a human player holds more than HAND_SIZE cards
  // at end of turn, defer draw/advance until they discard down to the cap.
  // (AI/offline safety net is implemented in Task 5.)
  if (p.hand.length > HAND_SIZE) {
    if (!p.isAI && !p.offline) {
      turn.pendingTrim = { max: HAND_SIZE };
      return;
    }
  }

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
