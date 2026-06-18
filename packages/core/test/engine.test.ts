import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/engine.js';
import type { GameState, Axial, Card } from '../src/types.js';
import type { Action } from '../src/actions.js';

function game(players = 2): GameState {
  const seeds = [
    { id: 'p0', name: 'A', color: 'red' as const },
    { id: 'p1', name: 'B', color: 'blue' as const },
    { id: 'p2', name: 'C', color: 'green' as const },
    { id: 'p3', name: 'D', color: 'yellow' as const },
  ].slice(0, players);
  return createGame(seeds, 'classic', 42);
}

function giveHand(s: GameState, pid: string, defs: string[]): void {
  const p = s.players.find((x) => x.id === pid)!;
  p.hand = defs.map((d, i): Card => ({ id: `${pid}:${d}#t${i}`, defId: d }));
}

function placeAt(s: GameState, pid: string, c: Axial): void {
  const p = s.players.find((x) => x.id === pid)!;
  const old = s.hexes.find((h) => h.q === p.position.q && h.r === p.position.r);
  if (old) old.occupant = undefined;
  p.position = { ...c };
  const h = s.hexes.find((h) => h.q === c.q && h.r === c.r);
  if (h) h.occupant = pid;
}

function run(s: GameState, pid: string, ...actions: Action[]) {
  let state = s;
  let last;
  for (const a of actions) {
    const r = applyAction(state, pid, a);
    state = r.state;
    last = r.result;
  }
  return { state, result: last! };
}

const pos = (s: GameState, pid: string) => s.players.find((p) => p.id === pid)!.position;

describe('setup', () => {
  it('deals 4 cards and places pieces on start hexes', () => {
    const s = game(2);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.players[0].deck).toHaveLength(4); // 8 - 4
    const slot1 = s.hexes.find((h) => h.slot === 1 && h.terrain === 'start')!;
    expect(s.players[0].position).toEqual({ q: slot1.q, r: slot1.r });
    const startOccupied = s.hexes.filter((h) => h.terrain === 'start' && h.occupant);
    expect(startOccupied).toHaveLength(2);
  });
});

describe('movement', () => {
  it('moves through a matching hex and keeps leftover power', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 }); // green1
    giveHand(s, 'p0', ['scout']); // machete 2
    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:scout#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } }, // green2 → uses all 2
    );
    expect(result.ok).toBe(true);
    expect(pos(state, 'p0')).toEqual({ q: 3, r: 0 });
    expect(state.turn!.activeMover!.remaining).toBe(0);
  });

  it('cannot combine two weak cards to enter one strong hex', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 });
    giveHand(s, 'p0', ['explorer', 'explorer']); // machete 1 each
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:explorer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } }, // green2 needs power 2
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a symbol mismatch', () => {
    const s = game();
    placeAt(s, 'p0', { q: 3, r: 0 }); // green2
    giveHand(s, 'p0', ['explorer']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:explorer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 4, r: 0 } }, // blue1
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/paddle/);
  });

  it('cannot enter a mountain', () => {
    const s = game();
    placeAt(s, 'p0', { q: 10, r: 0 }); // blue3 next to mountain (10,1)
    giveHand(s, 'p0', ['pioneer']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 10, r: 1 } },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/mountain/);
  });

  it('cannot enter an occupied hex', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 });
    placeAt(s, 'p1', { q: 3, r: 0 });
    giveHand(s, 'p0', ['scout']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:scout#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/occupied/);
  });

  it('joker can move as any symbol', () => {
    const s = game();
    placeAt(s, 'p0', { q: 3, r: 0 }); // green2
    giveHand(s, 'p0', ['adventurer']); // joker 2
    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:adventurer#t0', symbol: 'paddle' },
      { type: 'StepTo', to: { q: 4, r: 0 } }, // blue1
    );
    expect(result.ok).toBe(true);
    expect(pos(state, 'p0')).toEqual({ q: 4, r: 0 });
  });
});

describe('special spaces', () => {
  it('basecamp removes the spent cards from the game', () => {
    const s = game();
    placeAt(s, 'p0', { q: 11, r: 0 }); // green2, adjacent to basecamp (12,0) cost2
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller']);
    const { state, result } = run(s, 'p0', {
      type: 'ClearSpace',
      to: { q: 12, r: 0 },
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].removed).toHaveLength(2);
    expect(pos(state, 'p0')).toEqual({ q: 12, r: 0 });
  });

  it('rubble sends the spent cards to discard', () => {
    const s = game();
    placeAt(s, 'p0', { q: 6, r: 0 }); // yellow1, adjacent to rubble (7,0) cost2
    giveHand(s, 'p0', ['explorer', 'sailor']);
    const { state, result } = run(s, 'p0', {
      type: 'ClearSpace',
      to: { q: 7, r: 0 },
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].discard).toHaveLength(2);
    expect(state.players[0].removed).toHaveLength(0);
  });
});

describe('buying', () => {
  it('buys an on-board card with enough coins', () => {
    const s = game();
    giveHand(s, 'p0', ['traveller', 'traveller']); // 2 coins
    const { state, result } = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer', // cost 2
      paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].discard.some((c) => c.defId === 'photographer')).toBe(true);
    expect(state.turn!.hasBought).toBe(true);
    expect(state.market.find((m) => m.defId === 'photographer')!.count).toBe(2);
  });

  it('rejects a purchase without enough coins', () => {
    const s = game();
    giveHand(s, 'p0', ['traveller']); // 1 coin
    const { result } = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer',
      paymentCardIds: ['p0:traveller#t0'],
    });
    expect(result.ok).toBe(false);
  });

  it('allows only one purchase per turn', () => {
    const s = game();
    giveHand(s, 'p0', ['millionaire', 'millionaire']); // coin 4 each
    const r1 = applyAction(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer',
      paymentCardIds: ['p0:millionaire#t0'],
    });
    expect(r1.result.ok).toBe(true);
    const r2 = applyAction(r1.state, 'p0', {
      type: 'BuyCard',
      defId: 'scout',
      paymentCardIds: ['p0:millionaire#t1'],
    });
    expect(r2.result.ok).toBe(false);
  });
});

describe('turn flow', () => {
  it('end turn draws back to hand size and advances player', () => {
    const s = game(2);
    const r = applyAction(s, 'p0', { type: 'EndTurn' });
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.playerId).toBe('p1');
    expect(r.state.players[1].hand.length).toBe(4);
  });
});

describe('winning', () => {
  it('reaching El Dorado finishes the game after the final round', () => {
    let s = game(2);
    placeAt(s, 'p0', { q: 16, r: 0 }); // green2, adjacent to finish (17,0)
    giveHand(s, 'p0', ['pioneer']); // machete 5
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 17, r: 0 } },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.players[0].finished).toBe(true);
    expect(r.state.finalTurnsRemaining).toBe(1); // p1 gets one more turn

    // p0 ends turn → p1 takes the final turn
    r = run(r.state, 'p0', { type: 'EndTurn' });
    expect(r.state.turn!.playerId).toBe('p1');

    // p1 ends without finishing → game over, p0 wins
    r = run(r.state, 'p1', { type: 'EndTurn' });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBe('p0');
  });
});
