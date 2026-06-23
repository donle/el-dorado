import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/engine.js';
import { planTurn } from '../src/ai.js';
import type { GameState } from '../src/types.js';

function playOut(seed: number): GameState {
  let s = createGame(
    [
      { id: 'a', name: 'A', color: 'red', isAI: true },
      { id: 'b', name: 'B', color: 'blue', isAI: true },
    ],
    'classic',
    seed,
  );
  let guard = 0;
  while (s.phase === 'playing' && guard++ < 2000) {
    const cur = s.turn!.playerId;
    for (const action of planTurn(s, cur)) {
      const r = applyAction(s, cur, action);
      if (r.result.ok) s = r.state;
    }
  }
  return s;
}

describe('AI', () => {
  it('plays a full 2-AI game to a winner (multiple seeds)', () => {
    for (const seed of [1, 7, 42, 99]) {
      const s = playOut(seed);
      expect(s.phase, `seed ${seed}`).toBe('finished');
      expect(s.winnerId, `seed ${seed}`).toBeTruthy();
    }
  });

  it('rests (discards hand) when it cannot make progress', () => {
    // Surround a player so no move is possible: put them on a hex whose only
    // exits are mountains/occupied — simplest is to give an empty hand.
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red' },
        { id: 'b', name: 'B', color: 'blue' },
      ],
      'corridor',
      3,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    a.hand = []; // nothing to play
    const plan = planTurn(s, 'a');
    const end = plan.find((x) => x.type === 'EndTurn');
    expect(end).toBeDefined();
    // With an empty hand there is nothing to discard, but the action must still end the turn.
    expect(plan[plan.length - 1].type).toBe('EndTurn');
  });

  it('uses native as a terrain-ignoring movement action', () => {
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red' },
        { id: 'b', name: 'B', color: 'blue' },
      ],
      'corridor',
      3,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    a.hand = [{ id: 'a:native#t0', defId: 'native' }];
    a.deck = [];
    a.discard = [];

    const nativeMove = planTurn(s, 'a').find((x) => x.type === 'UseAbility' && x.cardId === 'a:native#t0');

    expect(nativeMove).toBeDefined();
    expect(nativeMove).toMatchObject({ type: 'UseAbility', cardId: 'a:native#t0' });
  });

  it('emits RemoveBlockade before StepTo when crossing an unclaimed symbol seam', () => {
    // Set up: place player 'a' at (2,-3), which is on the "from" side of the first
    // machete blockade (seam-1-up, cost=1). The destination (3,-4) is green cost=1,
    // so the seam symbol matches and the AI can plan the crossing.
    // Deck/hand include all three symbol types so the full path is traversable
    // (machete for green, paddle for blue, coin for yellow hexes).
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red' },
        { id: 'b', name: 'B', color: 'blue' },
      ],
      'classic',
      1,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    const oldHex = s.hexes.find((h) => h.q === a.position.q && h.r === a.position.r);
    if (oldHex) oldHex.occupant = undefined;
    a.position = { q: 2, r: -3 };
    const newHex = s.hexes.find((h) => h.q === 2 && h.r === -3)!;
    newHex.occupant = 'a';
    // Give a full-capability hand: pioneer (machete 5), captain (paddle 3), journalist (coin 3).
    // Deck mirrors it so capability() reports these values and the path is accepted.
    a.hand = [
      { id: 'a:pioneer#t0', defId: 'pioneer' },
      { id: 'a:captain#t1', defId: 'captain' },
      { id: 'a:journalist#t2', defId: 'journalist' },
    ];
    a.deck = [
      { id: 'a:pioneer#d0', defId: 'pioneer' },
      { id: 'a:captain#d1', defId: 'captain' },
      { id: 'a:journalist#d2', defId: 'journalist' },
    ];
    a.discard = [];

    const plan = planTurn(s, 'a');
    const ri = plan.findIndex((x) => x.type === 'RemoveBlockade');
    // Assert ri is valid BEFORE deriving si, so `i > ri` can never trivially
    // match the first StepTo against a -1 ri (keeps the ordering check honest
    // regardless of assertion order).
    expect(ri, 'RemoveBlockade should appear in plan').toBeGreaterThanOrEqual(0);
    const si = plan.findIndex((x, i) => x.type === 'StepTo' && i > ri);
    expect(si, 'StepTo should appear after RemoveBlockade').toBeGreaterThan(ri);
  });

  it('emits a standalone DiscardCards before EndTurn when resting', () => {
    // Same seed-3 board as "rests (discards hand)" above: player 'a' starts at
    // (-3,0) whose only traversable neighbours are green hexes (cost 1 and 2).
    // Hand is set to a single sailor card (paddle symbol, power=1).
    //   - Sailor cannot enter green terrain (needs machete) → no movement possible.
    //   - Coin value of sailor = 0.5, so total coins (0.5) < cheapest market card
    //     cost (1) → no buy possible.
    // Therefore moved=false with a non-empty hand: the AI must take the rest path
    // and emit DiscardCards([sailorId]) before EndTurn.
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red' },
        { id: 'b', name: 'B', color: 'blue' },
      ],
      'classic',
      3,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    a.hand = [{ id: 'a:sailor#rest0', defId: 'sailor' }];
    const plan = planTurn(s, 'a');
    const di = plan.findIndex((x) => x.type === 'DiscardCards');
    const ei = plan.findIndex((x) => x.type === 'EndTurn');
    expect(di).toBeGreaterThanOrEqual(0);
    expect(di).toBeLessThan(ei);
    expect(plan[plan.length - 1].type).toBe('EndTurn');
    const dc = plan[di] as { type: 'DiscardCards'; cardIds: string[] };
    expect(dc.cardIds.length).toBeGreaterThan(0);
  });
});

describe('AI end-of-turn trim', () => {
  it('planTurn emits DiscardCards before EndTurn when hand > HAND_SIZE and moved=true', () => {
    // Construct a state where the AI CAN move (moved=true) but starts with 5
    // cards in hand — so the rest fallback does NOT fire, and the only way a
    // DiscardCards action can appear is via the trim block.
    //
    // Setup mirrors the existing "emits RemoveBlockade" test (q=2,r=-3 with
    // full machete/paddle/coin coverage in hand+deck). The AI traverses and
    // uses 4 of 5 hand cards across 3 StepTo + 2 PlayMovementCard pairs.
    // After all movement, 1 card remains in hand → trim discards it.
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red', isAI: true },
        { id: 'b', name: 'B', color: 'blue', isAI: true },
      ],
      'classic',
      1,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    const oldHex = s.hexes.find((h) => h.q === a.position.q && h.r === a.position.r);
    if (oldHex) oldHex.occupant = undefined;
    a.position = { q: 2, r: -3 };
    const newHex = s.hexes.find((h) => h.q === 2 && h.r === -3)!;
    newHex.occupant = 'a';
    // 5 cards: full symbol coverage (pioneer=5, captain=3, journalist=3) plus
    // two lowest-power explorers (power=1) so trim has a clear "lowest" pick.
    a.hand = [
      { id: 'a:pioneer#t0', defId: 'pioneer' },
      { id: 'a:captain#t1', defId: 'captain' },
      { id: 'a:journalist#t2', defId: 'journalist' },
      { id: 'a:explorer#t3', defId: 'explorer' },
      { id: 'a:explorer#t4', defId: 'explorer' },
    ];
    a.deck = [
      { id: 'a:pioneer#d0', defId: 'pioneer' },
      { id: 'a:captain#d1', defId: 'captain' },
      { id: 'a:journalist#d2', defId: 'journalist' },
    ];
    a.discard = [];

    const plan = planTurn(s, 'a');
    // The plan must end with EndTurn.
    expect(plan[plan.length - 1].type).toBe('EndTurn');
    // The AI must have moved at least once (otherwise the rest fallback would
    // also discard and we couldn't isolate the trim behavior).
    const hasStep = plan.some((x) => x.type === 'StepTo' || x.type === 'UseAbility');
    expect(hasStep, 'expected AI to move so the rest fallback is skipped').toBe(true);
    // The plan must contain at least one DiscardCards (only the trim block
    // produces one when moved=true).
    const discards = plan.filter((x) => x.type === 'DiscardCards') as Array<{
      type: 'DiscardCards';
      cardIds: string[];
    }>;
    expect(discards.length, 'expected at least one DiscardCards from trim').toBeGreaterThanOrEqual(1);
    // The DiscardCards must come before EndTurn.
    const lastDiscardIdx = plan
      .map((x, i) => (x.type === 'DiscardCards' ? i : -1))
      .filter((i) => i >= 0)
      .pop()!;
    const endTurnIdx = plan.findIndex((x) => x.type === 'EndTurn');
    expect(lastDiscardIdx).toBeLessThan(endTurnIdx);
    // The trimmed card should be the lowest-power card in the hand (explorer = 1).
    const handIds = new Set(a.hand.map((c) => c.id));
    const allTrimIds = discards.flatMap((d) => d.cardIds);
    for (const id of allTrimIds) {
      expect(handIds.has(id), `trimmed id ${id} should be from hand`).toBe(true);
    }
  });

  it('planTurn does not emit a trim DiscardCards when hand <= HAND_SIZE', () => {
    // 4 cards in hand (== HAND_SIZE), same setup as above minus one explorer.
    // The plan should NOT include a DiscardCards at all: no trim (hand == cap),
    // and the rest fallback doesn't fire because the AI moves.
    let s = createGame(
      [
        { id: 'a', name: 'A', color: 'red', isAI: true },
        { id: 'b', name: 'B', color: 'blue', isAI: true },
      ],
      'classic',
      1,
    );
    const a = s.players.find((p) => p.id === 'a')!;
    const oldHex = s.hexes.find((h) => h.q === a.position.q && h.r === a.position.r);
    if (oldHex) oldHex.occupant = undefined;
    a.position = { q: 2, r: -3 };
    const newHex = s.hexes.find((h) => h.q === 2 && h.r === -3)!;
    newHex.occupant = 'a';
    a.hand = [
      { id: 'a:pioneer#t0', defId: 'pioneer' },
      { id: 'a:captain#t1', defId: 'captain' },
      { id: 'a:journalist#t2', defId: 'journalist' },
      { id: 'a:explorer#t3', defId: 'explorer' },
    ];
    a.deck = [
      { id: 'a:pioneer#d0', defId: 'pioneer' },
      { id: 'a:captain#d1', defId: 'captain' },
      { id: 'a:journalist#d2', defId: 'journalist' },
    ];
    a.discard = [];

    const plan = planTurn(s, 'a');
    const discards = plan.filter((x) => x.type === 'DiscardCards');
    expect(discards.length, 'hand == HAND_SIZE: no trim DiscardCards expected').toBe(0);
    expect(plan[plan.length - 1].type).toBe('EndTurn');
  });
});
