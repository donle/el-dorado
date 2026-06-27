/**
 * engine/helpers — tiny utilities shared by every action handler.
 * Kept dependency-free so the rest of the engine/ tree can import it
 * without forming cycles.
 */
import type { Axial, Blockade, Card, GameState, Hex, MoveSymbol, Player } from '../types.js';
import type { GameEvent } from '../actions.js';
import { isAdjacent } from '../hex.js';
import { blockadeMoveSymbol, sameCoord } from '../terrain.js';
import { shuffle } from '../rng.js';

/** Deep-clone game state. GameState is plain JSON data, so this is exact. */
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function symbolLabel(symbol: MoveSymbol): string {
  switch (symbol) {
    case 'machete':
      return '砍刀';
    case 'paddle':
      return '船桨';
    case 'coin':
      return '金币';
  }
}

export class RuleError extends Error {}

export function fail(state: GameState, error: string): { state: GameState; result: { ok: false; error: string } } {
  return { state, result: { ok: false, error } };
}

export function player(state: GameState, id: string): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new RuleError(`未知玩家：${id}`);
  return p;
}

export function hexAt(state: GameState, c: Axial): Hex | undefined {
  return state.hexes.find((h) => h.q === c.q && h.r === c.r);
}

export function crossesBlockadeEdge(blockade: Blockade, from: Axial, to: Axial): boolean {
  const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  return edges.some(
    (edge) =>
      (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
  );
}

export function blockadeBetween(state: GameState, from: Axial, to: Axial): Blockade | undefined {
  return state.blockades.find((b) => crossesBlockadeEdge(b, from, to));
}

export function claimBlockade(p: Player, blockade: Blockade | undefined, events: GameEvent[]): void {
  if (!blockade || blockade.claimedBy) return;
  blockade.claimedBy = p.id;
  p.claimedBlockades ??= [];
  if (!p.claimedBlockades.includes(blockade.id)) p.claimedBlockades.push(blockade.id);
  p.blockades = p.claimedBlockades.length;
  events.push({ type: 'blockadeClaimed', playerId: p.id, blockadeId: blockade.id });
}

export function blockadeRequirementLabel(blockade: Blockade): string {
  const symbol = blockadeMoveSymbol(blockade);
  return symbol ? `${symbolLabel(symbol)} ${blockade.cost} 点` : `弃 ${blockade.cost} 张手牌`;
}

export function takeFromHand(p: Player, cardId: string): Card {
  const idx = p.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) throw new RuleError(`这张牌不在手牌中：${cardId}`);
  return p.hand.splice(idx, 1)[0];
}

/** Draw `count` cards from `p`'s deck into `p`'s hand, reshuffling discard into
 *  deck when the deck is empty. Returns the number actually drawn. */
export function drawInto(state: GameState, p: Player, count: number): number {
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

// Re-exported so movement/abilities don't need a second import.
export { isAdjacent };
