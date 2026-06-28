/**
 * engine/movement — handles PlayMovementCard / StepTo / ClearSpace /
 * RemoveBlockade. Pure over the cloned state, mutates it in place and
 * pushes events to the caller's accumulator.
 */
import type { Action, GameEvent } from '../actions.js';
import type { Axial, GameState, Hex, MoveSymbol, Player } from '../types.js';
import { isAdjacent, neighbors } from '../hex.js';
import { getDef, movableSymbols } from '../cards.js';
import {
  blockadeBetween,
  blockadeRequirementLabel,
  claimBlockade,
  hexAt,
  player,
  RuleError,
  symbolLabel,
  takeFromHand,
} from './helpers.js';
import { blockadeMoveSymbol, blockadeRequiresDiscard, isFinishEntrance, sameCoord, terrainSymbol } from '../terrain.js';

export function playMovementCard(
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

export function moveTo(state: GameState, p: Player, to: Hex, events: GameEvent[]): void {
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

  // Caves variant: if the player stopped next to a cave-bearing mountain
  // hex that they did NOT just leave from, draw the top token from that
  // cave's pile into their stash. Anti-loop marker is updated below.
  drawCaveTokenIfAdjacent(state, p, events);
}

/**
 * Caves variant trigger. Called from `moveTo` after a piece lands on a
 * destination hex. Scans the 6 neighbours of `p.position` for a cave hex
 * (`caveId` set by setup), respects the anti-loop marker
 * (`p.lastCaveId`), and on a fresh cave draws the top of that pile.
 *
 * The first such cave found (deterministic neighbour order) is used when
 * multiple caves touch the destination, matching the rulebook example.
 */
function drawCaveTokenIfAdjacent(state: GameState, p: Player, events: GameEvent[]): void {
  const adjacentCaves = neighbors(p.position)
    .map((n) => state.hexes.find((h) => h.q === n.q && h.r === n.r))
    .filter((h): h is Hex & { caveId: string } => !!h && !!h.cave && !!h.caveId);
  if (adjacentCaves.length === 0) {
    // No cave adjacent: clear the marker so the next return is treated as
    // a fresh exploration.
    p.lastCaveId = null;
    state.lastExploredCave[p.id] = null;
    return;
  }
  const target = adjacentCaves[0];
  if (p.lastCaveId === target.caveId) {
    // Anti-loop: same cave as last draw. Skip.
    return;
  }
  const pile = state.cavePiles[target.caveId];
  if (!pile || pile.length === 0) {
    // Exhausted cave: still mark so the player can't farm an empty pile
    // by stepping on and off adjacent hexes.
    p.lastCaveId = target.caveId;
    state.lastExploredCave[p.id] = target.caveId;
    return;
  }
  const tokenId = pile.shift();
  if (tokenId) p.caveTokens.push(tokenId);
  p.lastCaveId = target.caveId;
  state.lastExploredCave[p.id] = target.caveId;
  if (tokenId) {
    events.push({ type: 'caveTokenDrawn', playerId: p.id, caveId: target.caveId, tokenId });
  }
}

export function finalTurnsAfter(state: GameState, playerId: string): number {
  const idx = state.turnOrder.indexOf(playerId);
  if (idx === -1) return 0;
  return state.turnOrder.slice(idx + 1).filter((id) => !player(state, id).finished).length;
}

export function assertEnterable(
  state: GameState,
  p: Player,
  to: Hex,
  opts: { allowMountain?: boolean; allowOccupied?: boolean } = {},
): void {
  if (to.terrain === 'mountain' && !opts.allowMountain) throw new RuleError('不能进入山地');
  const from = hexAt(state, p.position);
  if (to.terrain === 'eldorado' && !isFinishEntrance(from)) {
    throw new RuleError('必须先进入黄金城入口，才能进入黄金城');
  }
  if (to.occupant && to.occupant !== p.id && !opts.allowOccupied) {
    throw new RuleError('该地格已被占用');
  }
  if (!isAdjacent(p.position, to)) throw new RuleError('只能移动到相邻地格');
}

export function stepTo(state: GameState, playerId: string, to: Axial, events: GameEvent[]): void {
  const p = player(state, playerId);
  const hex = hexAt(state, to);
  if (!hex) throw new RuleError('没有这个地格');
  assertEnterable(state, p, hex, { allowOccupied: state.turn?.passThroughActive === true });

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
  // Cave `symbol_swap` armed on this turn: the next movement card plays
  // as the chosen symbol instead of its own. Cleared after the first
  // step consumes it.
  const effectiveSymbol = turn.symbolSwap ?? mover.symbol;
  if (required !== null && required !== effectiveSymbol) {
    throw new RuleError(`需要${symbolLabel(required)}才能进入`);
  }
  if (mover.remaining < deduct) throw new RuleError('移动力量不足');

  if (turn.symbolSwap) {
    mover.symbol = turn.symbolSwap;
    turn.symbolSwap = undefined;
  }
  mover.remaining -= deduct;
  claimBlockade(p, blockade, events);
  moveTo(state, p, hex, events);
}

export function clearSpace(
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

export function removeBlockade(
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
