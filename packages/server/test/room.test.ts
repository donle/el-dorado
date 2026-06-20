import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.js';
import { planTurn } from '@eldorado/core';

describe('Room', () => {
  it('assigns distinct colors and a host', () => {
    const room = new Room('TEST');
    const a = room.addHuman('Alice', () => {});
    const b = room.addHuman('Bob', () => {});
    expect(room.hostId).toBe(a.id);
    expect(a.color).not.toBe(b.color);
    expect(room.view().players).toHaveLength(2);
  });

  it('runs two AIs to a finished game with a winner', async () => {
    const room = new Room('TEST', () => Promise.resolve());
    room.addHuman('Host', () => {}); // host, but we drive via AI here
    room.addAI();
    // Convert the host into an AI for a fully-automated game.
    (room as unknown as { members: Array<{ isAI: boolean }> }).members[0].isAI = true;

    room.start('classic', 7);
    // Kick off: first player is now AI, so runAITurns plays the whole game.
    await room.runAITurns();

    expect(room.game).not.toBeNull();
    expect(room.game!.phase).toBe('finished');
    expect(room.game!.winnerId).toBeTruthy();
  });

  it('paces AI by broadcasting once per action, not once per turn', async () => {
    let stateCount = 0;
    const room = new Room('TEST', () => Promise.resolve()); // instant sleep
    room.addHuman('H', (m) => {
      if (m.type === 'state') stateCount++;
    });
    room.addHuman('B', () => {});
    room.start('classic', 1);

    // Make the CURRENT player an AI so runAITurns plays exactly that one turn,
    // then stops at the remaining human.
    const curId = room.game!.turn!.playerId;
    const curIdx = room.members.findIndex((m) => m.id === curId);
    (room as unknown as { members: Array<{ isAI: boolean }> }).members[curIdx].isAI = true;

    const expected = planTurn(room.game!, curId).length;
    expect(expected).toBeGreaterThanOrEqual(2); // a real opening turn has >1 action (seed 1)

    await room.runAITurns();

    // One broadcast per applied action (per-action pacing), not a single batched one.
    expect(stateCount).toBe(expected);
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

  it('turns a disconnected in-game human into an offline AI seat', () => {
    const room = new Room('TEST');
    const a = room.addHuman('Alice', () => {});
    room.addHuman('Bob', () => {});
    room.start('classic', 1);

    const changed = room.disconnect(a.id);
    const member = room.member(a.id)!;
    const player = room.game!.players.find((p) => p.id === a.id)!;

    expect(changed).toBe(true);
    expect(member.isAI).toBe(true);
    expect(member.offline).toBe(true);
    expect(player.isAI).toBe(true);
    expect(player.offline).toBe(true);
    expect(room.view().players.find((p) => p.id === a.id)?.offline).toBe(true);
  });

  it('returns host control to a connected human instead of keeping an AI host', () => {
    const room = new Room('TEST');
    const host = room.addHuman('Host', () => {});
    const ai = room.addAI();
    room.start('classic', 1);

    room.disconnect(host.id);
    expect(room.hostId).toBe(ai.id);

    room.phase = 'finished';
    room.returnToLobby();
    expect(room.hostId).toBe(ai.id);

    room.reconnect(host.id, () => {});
    expect(room.hostId).toBe(host.id);
    expect(room.view().players.find((p) => p.id === host.id)?.offline).toBe(false);
  });

  it('only the host can change the AI delay, clamped to [0,10000]', () => {
    const room = new Room('TEST');
    const host = room.addHuman('Host', () => {});
    const other = room.addHuman('Other', () => {});

    expect(room.view().aiDelayMs).toBe(1000); // default 1s

    room.setAiDelay(other.id, 3000); // non-host ignored
    expect(room.view().aiDelayMs).toBe(1000);

    room.setAiDelay(host.id, 3000);
    expect(room.view().aiDelayMs).toBe(3000);

    room.setAiDelay(host.id, 99999); // clamp max
    expect(room.view().aiDelayMs).toBe(10000);

    room.setAiDelay(host.id, -50); // clamp min
    expect(room.view().aiDelayMs).toBe(0);
  });
});
