import { describe, it, expect, vi } from 'vitest';
import { Room } from '../src/room.js';
import { planTurn, HAND_SIZE, type ServerMessage } from '@eldorado/core';

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

  it('ignores a stale disconnect after the player has reconnected', () => {
    const room = new Room('TEST');
    const oldSend = () => {};
    const newSend = () => {};
    const a = room.addHuman('Alice', oldSend);
    room.addHuman('Bob', () => {});
    room.start('classic', 1);

    room.reconnect(a.id, newSend);
    const changed = room.disconnect(a.id, oldSend);
    const member = room.member(a.id)!;
    const player = room.game!.players.find((p) => p.id === a.id)!;

    expect(changed).toBe(false);
    expect(member.isAI).toBe(false);
    expect(member.offline).toBe(false);
    expect(player.isAI).toBe(false);
    expect(player.offline).toBe(false);
    expect(room.view().players.find((p) => p.id === a.id)?.connected).toBe(true);
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

  it('changes the lobby map and starts with the selected map', () => {
    const room = new Room('TEST');
    room.addHuman('Host', () => {});
    room.addHuman('Other', () => {});

    room.setMap('official-home-stretch');

    expect(room.view().mapId).toBe('official-home-stretch');
    room.start(undefined, 1);
    expect(room.game!.mapId).toBe('official-home-stretch');
  });

  it('rejects invalid map ids without changing the selected map', () => {
    const room = new Room('TEST');
    room.addHuman('Host', () => {});
    room.addHuman('Other', () => {});

    expect(() => room.setMap('missing-map')).toThrow('未知地图');
    expect(room.view().mapId).toBe('classic');
  });

  it('does not allow changing the map after the game starts', () => {
    const room = new Room('TEST');
    room.addHuman('Host', () => {});
    room.addHuman('Other', () => {});
    room.start('classic', 1);

    expect(() => room.setMap('official-home-stretch')).toThrow('游戏已经开始');
    expect(room.view().mapId).toBe('classic');
  });

  it('broadcasts room closure to remaining players only', () => {
    const hostMessages: ServerMessage[] = [];
    const guestMessages: ServerMessage[] = [];
    const room = new Room('TEST');
    const host = room.addHuman('Host', (m) => hostMessages.push(m));
    room.addHuman('Guest', (m) => guestMessages.push(m));

    room.broadcastClosed('房主已退出，房间已解散', host.id);

    expect(room.closed).toBe(true);
    expect(hostMessages.some((m) => m.type === 'roomClosed')).toBe(false);
    expect(guestMessages).toContainEqual({ type: 'roomClosed', message: '房主已退出，房间已解散' });
  });
});

describe('AI end-of-turn trim (integration)', () => {
  it('AI runAITurns completes turn when AI hand > HAND_SIZE', async () => {
    // Build a 2-player room: host + one AI. After start() the host is the
    // current player, so make THEM the AI for this run (matches the
    // "convert host into AI" pattern used by the other AI tests).
    const room = new Room('TEST', () => Promise.resolve());
    room.addHuman('Host', () => {});
    room.addAI();
    room.start('classic', 7);

    // Flip the CURRENT player (turn player) to AI so runAITurns plays
    // exactly one AI turn and stops at the still-human seat.
    const curId = room.game!.turn!.playerId;
    const curIdx = room.members.findIndex((m) => m.id === curId);
    (room as unknown as { members: Array<{ isAI: boolean }> }).members[curIdx].isAI = true;
    const ai = room.game!.players.find((p) => p.id === curId)!;
    expect(ai.isAI).toBe(true);

    // Force the AI's hand above HAND_SIZE so the end-of-turn trim must run.
    ai.hand = [
      { id: 'a:pioneer#t0', defId: 'pioneer' },
      { id: 'a:captain#t1', defId: 'captain' },
      { id: 'a:journalist#t2', defId: 'journalist' },
      { id: 'a:explorer#t3', defId: 'explorer' },
      { id: 'a:explorer#t4', defId: 'explorer' },
    ];
    expect(ai.hand.length).toBeGreaterThan(HAND_SIZE);

    await room.runAITurns();

    // Re-fetch from the post-run state (applyAction rebuilds state, so
    // `ai` is stale).
    const aiAfter = room.game!.players.find((p) => p.id === curId)!;

    // Room did not crash and game continues (current player is now the
    // still-human seat).
    expect(room.game!.phase).toBe('playing');
    // Trim happened: AI hand is at or below the cap after the turn ends.
    expect(aiAfter.hand.length).toBeLessThanOrEqual(HAND_SIZE);
  });
});

describe('Game-start sync barrier', () => {
  it('startGame gates runAITurns until all humans ready', async () => {
    vi.useFakeTimers();
    try {
      const room = new Room('TEST', () => Promise.resolve());
      room.addHuman('Alice', () => {});
      room.addHuman('Bob', () => {});
      room.start('classic', 1);
      room.armReadyTimeout();

      // Neither human is ready yet — AI turns must NOT have begun.
      const turnBefore = room.game!.turn!.playerId;
      await vi.advanceTimersByTimeAsync(100);
      // The turn player hasn't moved: still the same player, no AI run started.
      expect(room.game!.turn!.playerId).toBe(turnBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('all humans ready triggers runAITurns', async () => {
    const messages: ServerMessage[] = [];
    const room = new Room('TEST', () => Promise.resolve());
    room.addHuman('Alice', (m) => messages.push(m));
    room.addHuman('Bob', (m) => messages.push(m));
    room.start('classic', 1);
    room.armReadyTimeout();

    // Mark both humans ready.
    const [a, b] = room.members;
    room.markReady(a.id);
    room.markReady(b.id);

    // Give the fire-and-forget runAITurns() a microtask to advance.
    await Promise.resolve();
    await Promise.resolve();

    // The barrier is empty: the last 'starting' broadcast after both
    // markReady calls reported an empty pendingPlayers list.
    const starts = messages.filter((m) => m.type === 'starting');
    expect(starts.length).toBeGreaterThan(0);
    const last = starts[starts.length - 1] as { pendingPlayers: string[] };
    expect(last.pendingPlayers).toEqual([]);
  });

  it('all-AI game skips the barrier and runs AI immediately', async () => {
    const room = new Room('TEST', () => Promise.resolve());
    room.addHuman('Host', () => {});
    room.addAI();
    // Make host an AI so we have a full all-AI lineup.
    room.members[0].isAI = true;
    room.start('classic', 7);

    // armReadyTimeout should detect empty pendingReady and run AI directly.
    room.armReadyTimeout();
    // runAITurns is fire-and-forget; flush microtasks until the game
    // finishes (or until we hit a safety cap to avoid hanging).
    for (let i = 0; i < 5000 && room.game!.phase !== 'finished'; i++) {
      await Promise.resolve();
    }

    expect(room.game!.phase).toBe('finished');
  });

  it('30s timeout flips un-ready humans to AI and runs AI', async () => {
    vi.useFakeTimers();
    try {
      const room = new Room('TEST', () => Promise.resolve());
      const alice = room.addHuman('Alice', () => {});
      const bob = room.addHuman('Bob', () => {});
      room.start('classic', 1);
      room.armReadyTimeout();

      // Advance to just before timeout — humans should still be human.
      await vi.advanceTimersByTimeAsync(29_999);
      expect(room.member(alice.id)!.isAI).toBe(false);
      expect(room.member(bob.id)!.isAI).toBe(false);

      // Cross the timeout boundary.
      await vi.advanceTimersByTimeAsync(2);
      expect(room.member(alice.id)!.isAI).toBe(true);
      expect(room.member(bob.id)!.isAI).toBe(true);
      expect(room.member(alice.id)!.offline).toBe(true);
      expect(room.member(bob.id)!.offline).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('broadcastStarting emits the current pendingPlayers list', () => {
    const messages: ServerMessage[] = [];
    const room = new Room('TEST');
    room.addHuman('Alice', (m) => messages.push(m));
    room.addHuman('Bob', (m) => messages.push(m));
    room.addAI();
    room.start('classic', 1);

    messages.length = 0;
    room.broadcastStarting();
    const starts = messages.filter((m) => m.type === 'starting');
    expect(starts).toHaveLength(2);
    const pending = (starts[0] as { pendingPlayers: string[] }).pendingPlayers;
    expect(pending).toHaveLength(2);
    expect(pending).toContain(room.members[0].id);
    expect(pending).toContain(room.members[1].id);
  });

  it('disconnect during barrier removes the player from pendingReady and updates clients', () => {
    const messages: ServerMessage[] = [];
    const room = new Room('TEST', () => Promise.resolve());
    const alice = room.addHuman('Alice', (m) => messages.push(m));
    const bob = room.addHuman('Bob', (m) => messages.push(m));
    room.start('classic', 1);

    messages.length = 0;
    const changed = room.disconnect(alice.id);

    expect(changed).toBe(true);
    // Alice is now AI+offline (existing disconnect semantics).
    expect(room.member(alice.id)!.isAI).toBe(true);
    expect(room.member(alice.id)!.offline).toBe(true);

    // Clients received an updated `starting` broadcast that no longer lists Alice.
    const starts = messages.filter((m) => m.type === 'starting') as Array<{
      type: 'starting';
      pendingPlayers: string[];
    }>;
    expect(starts.length).toBeGreaterThanOrEqual(1);
    const lastPending = starts[starts.length - 1].pendingPlayers;
    expect(lastPending).toEqual([bob.id]);
  });
});
