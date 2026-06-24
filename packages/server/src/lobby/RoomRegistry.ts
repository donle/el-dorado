import { Room, RoomManager } from '../room.js';

/**
 * Per-connection lobby session.
 *
 * Stage 1 stored this in a local `Map` in `index.ts`; Stage 3 lifts it into
 * the lobby layer so `LobbyService` can read/write it without depending on
 * transport wiring.
 */
export interface Session {
  room: Room | null;
  playerId: string | null;
}

/**
 * Room + session registry.
 *
 * `manager` is the existing `RoomManager` from `room.ts` (full split happens
 * in Stage 7). `sessions` tracks which connection id is bound to which room
 * and player.
 */
export class RoomRegistry {
  private manager = new RoomManager();
  private sessions = new Map<string, Session>();

  // --- manager pass-through (Stage 7 will fully move these into the registry)

  createRoom(): Room { return this.manager.create(); }
  getRoom(code: string): Room | null { return this.manager.get(code) ?? null; }
  disposeRoom(code: string): void { this.manager.dispose(code); }

  // --- session tracking

  getSession(connId: string): Session | undefined { return this.sessions.get(connId); }
  requireSession(connId: string): Session {
    const s = this.sessions.get(connId);
    if (!s) throw new Error(`No session for connection ${connId}`);
    return s;
  }
  setSession(connId: string, session: Session): void { this.sessions.set(connId, session); }
  clearSession(connId: string): void { this.sessions.delete(connId); }

  /** Iterate every connection id currently bound to a given room. */
  connectionsInRoom(room: Room): Array<[string, Session]> {
    const out: Array<[string, Session]> = [];
    for (const [connId, session] of this.sessions) {
      if (session.room === room) out.push([connId, session]);
    }
    return out;
  }
}
