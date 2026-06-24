/**
 * Characterization tests for GameStore — the server-driven state slice.
 *
 * The store exposes a pure reducer plus an observable API. These tests
 * document its current behavior so future refactors can be confidence-checked.
 */
import { describe, it, expect } from 'vitest';
import { GameStore } from './GameStore.js';
import type { GameState, RoomView } from '@eldorado/core';

const sampleRoom: RoomView = {
  code: 'ABCD',
  hostId: 'p1',
  phase: 'lobby',
  mapId: 'classic',
  aiDelayMs: 1000,
  players: [],
};

const sampleGame: GameState = {
  mapId: 'classic',
  hexes: [],
  blockades: [],
  players: [],
  market: [],
  turnOrder: [],
  currentPlayerIdx: 0,
  phase: 'playing',
  turn: null,
  turnNumber: 1,
  finalRoundTriggeredBy: null,
  finalTurnsRemaining: null,
  winnerId: null,
  rngState: 0,
};

describe('GameStore', () => {
  it('starts in lobby phase with no room', () => {
    const s = new GameStore();
    expect(s.getState().phase).toBe('lobby');
    expect(s.getState().room).toBeNull();
    expect(s.getState().game).toBeNull();
    expect(s.getState().errorMessage).toBeNull();
    expect(s.getState().roomClosedMessage).toBeNull();
  });

  it('applies a room message: sets room + phase', () => {
    const s = new GameStore();
    s.dispatch({ type: 'room', room: sampleRoom });
    expect(s.getState().phase).toBe('lobby');
    expect(s.getState().room?.code).toBe('ABCD');
  });

  it('applies a state message: stores game and switches to playing', () => {
    const s = new GameStore();
    s.dispatch({ type: 'room', room: { ...sampleRoom, phase: 'playing' } });
    s.dispatch({ type: 'state', state: sampleGame });
    expect(s.getState().phase).toBe('playing');
    expect(s.getState().game).toBe(sampleGame);
  });

  it('applies roomClosed: clears room and stores message', () => {
    const s = new GameStore();
    s.dispatch({ type: 'room', room: sampleRoom });
    s.dispatch({ type: 'roomClosed', message: '房主已退出' });
    expect(s.getState().room).toBeNull();
    expect(s.getState().phase).toBe('lobby');
    expect(s.getState().roomClosedMessage).toBe('房主已退出');
  });

  it('applies error: stores message without changing phase', () => {
    const s = new GameStore();
    s.dispatch({ type: 'error', message: 'NOT_YOUR_TURN' });
    expect(s.getState().errorMessage).toBe('NOT_YOUR_TURN');
    expect(s.getState().phase).toBe('lobby');
  });

  it('a room message clears a previous errorMessage', () => {
    const s = new GameStore();
    s.dispatch({ type: 'error', message: 'X' });
    s.dispatch({ type: 'room', room: sampleRoom });
    expect(s.getState().errorMessage).toBeNull();
  });

  it('joined and starting are no-ops (lobby-controller territory)', () => {
    const s = new GameStore();
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.dispatch({ type: 'joined', code: 'ABCD', playerId: 'p1' });
    s.dispatch({ type: 'starting', pendingPlayers: ['p1', 'p2'] });
    expect(calls).toBe(0);
  });

  it('notifies subscribers only when state changes', () => {
    const s = new GameStore();
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.dispatch({ type: 'joined', code: 'ABCD', playerId: 'p1' }); // no-op
    expect(calls).toBe(0);
    s.dispatch({ type: 'room', room: sampleRoom });
    expect(calls).toBe(1);
  });

  it('unsubscribe stops notifications', () => {
    const s = new GameStore();
    let calls = 0;
    const unsub = s.subscribe(() => {
      calls += 1;
    });
    s.dispatch({ type: 'room', room: sampleRoom });
    unsub();
    s.dispatch({ type: 'error', message: 'x' });
    expect(calls).toBe(1);
  });

  it('reset() returns to initial state and notifies', () => {
    const s = new GameStore();
    s.dispatch({ type: 'room', room: sampleRoom });
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.reset();
    expect(s.getState().phase).toBe('lobby');
    expect(s.getState().room).toBeNull();
    expect(calls).toBe(1);
  });

  it('patch() merges fields and notifies', () => {
    const s = new GameStore();
    s.dispatch({ type: 'room', room: sampleRoom });
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.patch({ errorMessage: 'X' });
    expect(s.getState().errorMessage).toBe('X');
    expect(s.getState().room?.code).toBe('ABCD');
    expect(calls).toBe(1);
  });
});
