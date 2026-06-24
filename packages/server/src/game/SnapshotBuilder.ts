/**
 * SnapshotBuilder — derives the `RoomView` snapshot and the per-event broadcast
 * envelopes from a `Room`'s current state. Extracted from `room.ts` so the
 * aggregate root (`Room`) doesn't carry serialization concerns.
 *
 * All methods are pure: given the same `room` state, they return the same
 * `ServerMessage` payloads. They are responsible for shaping the wire format,
 * not for deciding when to send.
 */
import type { GameEvent, RoomView, ServerMessage } from '@eldorado/core';
import type { Room } from '../room.js';

/** Minimal read-only view of Room that SnapshotBuilder needs. */
interface RoomSnapshot {
  readonly code: string;
  readonly hostId: string;
  readonly phase: 'lobby' | 'playing' | 'finished';
  readonly mapId: string;
  readonly aiDelayMs: number;
  readonly members: Room['members'];
  readonly game: Room['game'];
  readonly pendingReady: ReadonlySet<string>;
}

export function buildRoomView(room: RoomSnapshot): RoomView {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    mapId: room.mapId,
    aiDelayMs: room.aiDelayMs,
    players: room.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      isAI: m.isAI,
      connected: m.offline ? false : m.isAI || m.send !== null,
      offline: m.offline,
    })),
  };
}

/** Compose the `room` snapshot message. */
export function roomMessage(room: RoomSnapshot): ServerMessage {
  return { type: 'room', room: buildRoomView(room) };
}

/** Compose the `state` message. Returns null when the room has no live game. */
export function stateMessage(room: RoomSnapshot, events: GameEvent[] = []): ServerMessage | null {
  if (!room.game) return null;
  return { type: 'state', state: room.game, events };
}

/** Compose the `starting` message — the ready barrier snapshot. */
export function startingMessage(room: RoomSnapshot): ServerMessage {
  return { type: 'starting', pendingPlayers: [...room.pendingReady] };
}
