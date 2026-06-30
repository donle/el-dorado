import { describe, expect, it, vi } from 'vitest';
import type { RoomView } from '@eldorado/core';
import { LobbyController } from './LobbyController.js';
import { shouldArmLaunchCountdown } from './LobbyView.js';
import type { ISocketPort, SocketEvent } from '../net/SocketPort.js';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeSocket implements ISocketPort {
  sent: unknown[] = [];

  send(message: unknown): void {
    this.sent.push(message);
  }

  on(_handler: (event: SocketEvent) => void): () => void {
    return () => {};
  }
}

describe('LobbyController launch countdown', () => {
  const lobbyRoom: RoomView = {
    code: 'TEST',
    hostId: 'p1',
    phase: 'lobby',
    mapId: 'classic',
    aiDelayMs: 1000,
    players: [
      { id: 'p1', name: 'A', color: 'red', isAI: false, connected: true },
      { id: 'p2', name: 'B', color: 'blue', isAI: false, connected: true },
    ],
  };

  it('starts the local countdown when a lobby room transitions to playing', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    try {
      const controller = new LobbyController({ socket: new FakeSocket() as ISocketPort });
      const access = controller as unknown as {
        onMessage(message: unknown): void;
        state: { isLaunching: boolean };
      };
      access.onMessage({ type: 'joined', code: 'TEST', playerId: 'p2' });
      access.onMessage({ type: 'room', room: lobbyRoom });

      access.onMessage({ type: 'room', room: { ...lobbyRoom, phase: 'playing' } });

      expect(access.state.isLaunching).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not arm a new numeric countdown after the local countdown has completed', () => {
    expect(shouldArmLaunchCountdown({ isLaunching: true, isStartingDone: true })).toBe(false);
  });

  it('clears the launch overlay when the ready barrier reports no pending players', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    try {
      const controller = new LobbyController({ socket: new FakeSocket() as ISocketPort });
      (controller as unknown as { state: { isLaunching: boolean; isStartingDone: boolean } }).state.isLaunching = true;
      (controller as unknown as { state: { isLaunching: boolean; isStartingDone: boolean } }).state.isStartingDone = true;

      (controller as unknown as { onMessage(message: unknown): void }).onMessage({ type: 'starting', pendingPlayers: [] });

      expect((controller as unknown as { state: { isLaunching: boolean } }).state.isLaunching).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('clears the launch overlay when the first game state arrives', () => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('sessionStorage', new MemoryStorage());
    try {
      const controller = new LobbyController({ socket: new FakeSocket() as ISocketPort });
      (controller as unknown as { state: { isLaunching: boolean; isStartingDone: boolean } }).state.isLaunching = true;
      (controller as unknown as { state: { isLaunching: boolean; isStartingDone: boolean } }).state.isStartingDone = false;

      (controller as unknown as { onMessage(message: unknown): void }).onMessage({ type: 'state' });

      expect((controller as unknown as { state: { isLaunching: boolean } }).state.isLaunching).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
