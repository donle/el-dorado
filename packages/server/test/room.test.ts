import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.js';

describe('Room', () => {
  it('assigns distinct colors and a host', () => {
    const room = new Room('TEST');
    const a = room.addHuman('Alice', () => {});
    const b = room.addHuman('Bob', () => {});
    expect(room.hostId).toBe(a.id);
    expect(a.color).not.toBe(b.color);
    expect(room.view().players).toHaveLength(2);
  });

  it('runs two AIs to a finished game with a winner', () => {
    const room = new Room('TEST');
    room.addHuman('Host', () => {}); // host, but we drive via AI here
    room.addAI();
    // Convert the host into an AI for a fully-automated game.
    (room as unknown as { members: Array<{ isAI: boolean }> }).members[0].isAI = true;

    room.start('classic', 7);
    // Kick off: first player is now AI, so runAITurns plays the whole game.
    room.runAITurns();

    expect(room.game).not.toBeNull();
    expect(room.game!.phase).toBe('finished');
    expect(room.game!.winnerId).toBeTruthy();
  });

  it('rejects actions out of turn', () => {
    const room = new Room('TEST');
    const a = room.addHuman('Alice', () => {});
    room.addHuman('Bob', () => {});
    room.start('classic', 1);
    const wrong = a.id === room.game!.turn!.playerId ? room.view().players[1].id : a.id;
    const res = room.handleAction(wrong, { type: 'EndTurn' });
    expect(res.ok).toBe(false);
  });
});
