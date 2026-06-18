import type {
  GameState,
  Player,
  Hex,
  Axial,
  MoveSymbol,
  Terrain,
  Card,
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
  if (state.phase !== 'playing') return fail(state, 'Game is not in progress');
  if (!state.turn || state.turn.playerId !== playerId) {
    return fail(state, 'Not your turn');
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
    case 'UseAbility':
      return useAbility(state, playerId, action, events);
    case 'EndTurn':
      return endTurn(state, playerId, action.discardCardIds ?? [], events);
  }
}

// --- helpers ---

function player(state: GameState, id: string): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new RuleError(`Unknown player ${id}`);
  return p;
}

function hexAt(state: GameState, c: Axial): Hex | undefined {
  return state.hexes.find((h) => h.q === c.q && h.r === c.r);
}

function takeFromHand(p: Player, cardId: string): Card {
  const idx = p.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new RuleError(`Card ${cardId} not in hand`);
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
  if (!card) throw new RuleError('Card not in hand');
  const symbols = movableSymbols(card.defId);
  if (!symbols.includes(symbol)) {
    throw new RuleError(`Card cannot move as ${symbol}`);
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

  if (to.terrain === 'finish') {
    p.finished = true;
    p.finishedAt = state.turnNumber;
    to.occupant = undefined; // the El Dorado gate is not blocked
    events.push({ type: 'reachedEldorado', playerId: p.id });
    if (state.finalTurnsRemaining === null) {
      state.finalRoundTriggeredBy = p.id;
      state.finalTurnsRemaining = state.players.filter((x) => !x.finished).length;
    }
  }
}

function assertEnterable(p: Player, to: Hex): void {
  if (to.terrain === 'mountain') throw new RuleError('Cannot enter a mountain');
  if (to.occupant && to.occupant !== p.id) throw new RuleError('Hex is occupied');
  if (!isAdjacent(p.position, to)) throw new RuleError('Hex is not adjacent');
}

function stepTo(state: GameState, playerId: string, to: Axial, events: GameEvent[]): void {
  const p = player(state, playerId);
  const turn = state.turn!;
  const mover = turn.activeMover;
  if (!mover || mover.remaining <= 0) throw new RuleError('No active movement card');
  const hex = hexAt(state, to);
  if (!hex) throw new RuleError('No such hex');
  assertEnterable(p, hex);

  if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') {
    throw new RuleError('Use ClearSpace to enter this terrain');
  }

  // The El Dorado gate (finish) may demand a specific symbol + cost; the start
  // tile is a free wildcard; other terrains use their symbol + cost.
  let required: MoveSymbol | null;
  let deduct: number;
  if (hex.terrain === 'finish') {
    required = hex.reqSymbol ?? null;
    deduct = Math.max(hex.cost, 1);
  } else if (hex.terrain === 'start') {
    required = null;
    deduct = 1;
  } else {
    required = terrainSymbol(hex.terrain);
    deduct = hex.cost;
  }
  if (required !== null && required !== mover.symbol) {
    throw new RuleError(`Need ${required} to enter`);
  }
  if (mover.remaining < deduct) throw new RuleError('Not enough movement power');

  mover.remaining -= deduct;
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
  if (!hex) throw new RuleError('No such hex');
  if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp') {
    throw new RuleError('Not a clearable space');
  }
  assertEnterable(p, hex);
  if (cardIds.length !== hex.cost) {
    throw new RuleError(`Need exactly ${hex.cost} cards`);
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
  if (turn.hasBought) throw new RuleError('Already bought this turn');

  const pile = state.market.find((m) => m.defId === defId);
  if (!pile || pile.count <= 0) throw new RuleError('Card not available');
  if (!pile.onBoard && !freeOnBoardSlot(state)) {
    throw new RuleError('Card is not on the board');
  }

  const cost = getDef(defId).cost;
  let power = 0;
  const cards: Card[] = [];
  for (const id of paymentCardIds) {
    const card = p.hand.find((c) => c.id === id);
    if (!card) throw new RuleError(`Payment card ${id} not in hand`);
    power += coinValue(card.defId);
    cards.push(card);
  }
  if (power < cost) throw new RuleError(`Need ${cost} coins, have ${power}`);

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
  if (def.kind !== 'action') throw new RuleError('Not an action card');

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
      if (!defId) throw new RuleError('No card chosen');
      const pile = state.market.find((m) => m.defId === defId);
      if (!pile || pile.count <= 0) throw new RuleError('Card not available');
      p.discard.push(mintCard(p, defId));
      pile.count -= 1;
      if (pile.count === 0 && pile.onBoard) {
        pile.onBoard = false;
        promoteOffBoard(state);
      }
      break;
    }
    case 'native': {
      if (!action.nativeTo) throw new RuleError('No destination chosen');
      const hex = hexAt(state, action.nativeTo);
      if (!hex) throw new RuleError('No such hex');
      assertEnterable(p, hex); // ignores terrain cost/symbol, but not mountain/occupied
      moveTo(state, p, hex, events);
      break;
    }
    default:
      throw new RuleError('Ability not implemented');
  }
  events.push({ type: 'ability', playerId, cardId: action.cardId });
}

function removeFromHand(p: Player, turn: GameState['turn'], cardIds: string[], max: number): void {
  if (cardIds.length > max) throw new RuleError(`Can remove at most ${max} cards`);
  for (const id of cardIds) {
    const card = takeFromHand(p, id);
    turn!.removedThisTurn.push(card);
  }
}

// --- end of turn ---

function endTurn(
  state: GameState,
  playerId: string,
  discardCardIds: string[],
  events: GameEvent[],
): void {
  const p = player(state, playerId);
  const turn = state.turn!;

  // Optionally discard chosen leftover hand cards.
  for (const id of discardCardIds) {
    const card = takeFromHand(p, id);
    p.discard.push(card);
  }

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
