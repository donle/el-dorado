/**
 * engine/turn — handles EndTurn (resolve cards played, trim hand, draw,
 * advance). Also owns `advanceTurn`, `endGame`, and the AI/offline
 * `autoDiscardLowestPower` safety net. No imports from discard.ts — keeps
 * the dependency direction discard → turn only.
 */
import type { GameState, Player } from '../types.js';
import type { GameEvent } from '../actions.js';
import { getDef, HAND_SIZE } from '../cards.js';
import { drawInto, player, takeFromHand } from './helpers.js';

export function endTurn(state: GameState, playerId: string, events: GameEvent[]): void {
  const p = player(state, playerId);
  const turn = state.turn!;

  // Resolve cards played this turn.
  for (const card of turn.inPlay) {
    if (getDef(card.defId).singleUse) p.removed.push(card);
    else p.discard.push(card);
  }
  for (const card of turn.removedThisTurn) p.removed.push(card);

  // Hand-cap trim check: if a player holds more than HAND_SIZE cards at end
  // of turn, defer draw/advance for humans until they discard down to the cap.
  // AI/offline safety net auto-discards the lowest-power cards so the room
  // doesn't stall on a missing DiscardCards action.
  if (p.hand.length > HAND_SIZE) {
    if (p.isAI || p.offline) {
      autoDiscardLowestPower(state, p, p.hand.length - HAND_SIZE, events);
      // Falls through to normal draw + advanceTurn below.
    } else {
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

/** Safety net for AI / offline players: when they end a turn with a hand over
 *  HAND_SIZE (because their plan forgot a DiscardCards action), automatically
 *  discard the lowest-power-first cards down to the cap. */
function autoDiscardLowestPower(
  state: GameState,
  p: Player,
  count: number,
  events: GameEvent[],
): void {
  const ids = p.hand
    .slice()
    .sort((a, b) => getDef(a.defId).power - getDef(b.defId).power)
    .slice(0, count)
    .map((c) => c.id);

  for (const id of ids) {
    const card = takeFromHand(p, id);
    p.discard.push(card);
  }
  if (state.turn) state.turn.hasDiscarded = true;
  events.push({ type: 'discarded', playerId: p.id, count: ids.length });

  // Diagnostic so an AI plan missing DiscardCards is still diagnosable in
  // production logs. Uses globalThis.cast since core's tsconfig lib doesn't
  // include dom (pre-existing constraint from the monolithic engine.ts).
  (globalThis as unknown as { console?: { warn: (msg: string) => void } }).console?.warn(
    `[AI-TRIM-SAFETY] auto-discarded ${ids.length} card(s) for AI/offline player ${p.id} ` +
      `at end of turn (plan likely missing DiscardCards).`,
  );
}

export function advanceTurn(state: GameState, events: GameEvent[]): void {
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

export function endGame(state: GameState, events: GameEvent[]): void {
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