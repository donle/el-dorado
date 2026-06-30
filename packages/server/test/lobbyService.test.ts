import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@eldorado/core';
import { LobbyService } from '../src/lobby/LobbyService.js';
import { RoomRegistry } from '../src/lobby/RoomRegistry.js';

describe('LobbyService start barrier', () => {
  it('does not broadcast game state when startGame first arms the launch countdown', () => {
    const { service, registry, messages } = makeService();

    registry.setSession('host', { room: null, playerId: null, send: null });
    registry.setSession('guest', { room: null, playerId: null, send: null });
    service.handle('host', { type: 'createRoom', name: 'Host' });
    const room = registry.getSession('host')!.room!;
    service.handle('guest', { type: 'joinRoom', code: room.code, name: 'Guest' });

    messages.get('host')!.length = 0;
    messages.get('guest')!.length = 0;

    service.handle('host', { type: 'startGame', mapId: 'classic' });

    for (const sent of messages.values()) {
      expect(sent.map((m) => m.type)).toEqual(['room', 'starting']);
    }
  });
});

function makeService(): {
  service: LobbyService;
  registry: RoomRegistry;
  messages: Map<string, ServerMessage[]>;
} {
  const registry = new RoomRegistry();
  const messages = new Map<string, ServerMessage[]>([
    ['host', []],
    ['guest', []],
  ]);
  const sendTo = (connId: string, msg: ServerMessage): void => {
    messages.get(connId)?.push(msg);
  };
  const service = new LobbyService({ registry, sendTo });
  return { service, registry, messages };
}
