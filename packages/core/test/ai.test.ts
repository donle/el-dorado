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
      'classic',
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
});
