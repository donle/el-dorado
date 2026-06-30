/**
 * LobbyService — domain service for create/join/leave/host actions.
 *
 * Stage 3 lifts the lobby message handlers out of `index.ts`. Game-phase
 * actions (`action`, `ready`, `setAiDelay`) stay in `index.ts` for now and
 * move to `game/ActionDispatcher` in Stage 7.
 */
import type { ClientMessage, ServerMessage } from '@eldorado/core';
import type { Send } from '../room.js';
import type { RoomRegistry, Session } from './RoomRegistry.js';
import { validateMapId } from './mapSelection.js';

/** Message types handled by LobbyService. */
type LobbyMessage = Extract<
  ClientMessage,
  | { type: 'createRoom' }
  | { type: 'joinRoom' }
  | { type: 'rejoin' }
  | { type: 'addAI' }
  | { type: 'removePlayer' }
  | { type: 'setMap' }
  | { type: 'leaveRoom' }
  | { type: 'returnToLobby' }
  | { type: 'startGame' }
>;

export interface LobbyServiceDeps {
  registry: RoomRegistry;
  sendTo: (connId: string, msg: ServerMessage) => void;
}

export class LobbyService {
  constructor(private readonly deps: LobbyServiceDeps) {}

  /**
   * Dispatch a lobby message. Errors are translated to `ServerMessage` and
   * sent back to the originating connection; the call never throws.
   */
  handle(connId: string, msg: LobbyMessage): void {
    try {
      switch (msg.type) {
        case 'createRoom': return this.createRoom(connId, msg.name);
        case 'joinRoom': return this.joinRoom(connId, msg.code, msg.name);
        case 'rejoin': return this.rejoin(connId, msg.code, msg.playerId);
        case 'addAI': return this.addAI(connId);
        case 'removePlayer': return this.removePlayer(connId, msg.playerId);
        case 'setMap': return this.setMap(connId, msg.mapId);
        case 'leaveRoom': return this.leaveRoom(connId);
        case 'returnToLobby': return this.returnToLobby(connId);
        case 'startGame': return this.startGame(connId, msg.mapId);
      }
    } catch (err) {
      this.deps.sendTo(connId, { type: 'error', message: (err as Error).message });
    }
  }

  // --- handlers ------------------------------------------------------------

  private createRoom(connId: string, name: string): void {
    const room = this.deps.registry.createRoom();
    const send = this.connectionSend(connId);
    const me = room.addHuman(name, send);
    this.deps.registry.setSession(connId, { room, playerId: me.id, send });
    this.deps.sendTo(connId, { type: 'joined', code: room.code, playerId: me.id });
    room.broadcastRoom();
  }

  private joinRoom(connId: string, code: string, name: string): void {
    const room = this.deps.registry.getRoom(code);
    if (!room) {
      this.deps.sendTo(connId, { type: 'error', message: '没有找到这个房间' });
      return;
    }
    const send = this.connectionSend(connId);
    const me = room.addHuman(name, send);
    this.deps.registry.setSession(connId, { room, playerId: me.id, send });
    this.deps.sendTo(connId, { type: 'joined', code: room.code, playerId: me.id });
    room.broadcastRoom();
  }

  private rejoin(connId: string, code: string, playerId: string): void {
    const room = this.deps.registry.getRoom(code);
    if (!room) {
      this.deps.sendTo(connId, { type: 'error', message: '没有找到这个房间' });
      return;
    }
    const send = this.connectionSend(connId);
    const me = room.reconnect(playerId, send);
    if (!me) {
      this.deps.sendTo(connId, { type: 'error', message: '玩家不在这个房间里' });
      return;
    }
    this.deps.registry.setSession(connId, { room, playerId: me.id, send });
    this.deps.sendTo(connId, { type: 'joined', code: room.code, playerId: me.id });
    room.broadcastRoom();
    if (room.game) this.deps.sendTo(connId, { type: 'state', state: room.game });
  }

  private addAI(connId: string): void {
    const session = this.requireSession(connId);
    this.requireHost(session);
    session.room!.addAI();
    session.room!.broadcastRoom();
  }

  private removePlayer(connId: string, playerId: string): void {
    const session = this.requireSession(connId);
    this.requireHost(session);
    session.room!.remove(playerId);
    session.room!.broadcastRoom();
  }

  private setMap(connId: string, mapId: string): void {
    const session = this.requireSession(connId);
    this.requireHost(session);
    session.room!.setMap(validateMapId(mapId));
    session.room!.broadcastRoom();
  }

  private leaveRoom(connId: string): void {
    const session = this.deps.registry.getSession(connId);
    if (!session || !session.room || !session.playerId) return;
    const { room, playerId } = session;
    if (room.phase === 'playing') {
      const changed = room.disconnect(playerId, session.send ?? undefined);
      if (changed) {
        room.broadcastRoom();
        room.broadcastState();
        void room.runAITurns();
      }
    } else {
      if (playerId === room.hostId) {
        room.broadcastClosed('房主已退出，房间已解散', playerId);
        this.deps.registry.disposeRoom(room.code);
        this.deps.registry.clearSession(connId);
        return;
      }
      room.remove(playerId);
      room.broadcastRoom();
      if (room.members.length === 0) this.deps.registry.disposeRoom(room.code);
    }
    this.deps.registry.clearSession(connId);
  }

  private returnToLobby(connId: string): void {
    const session = this.deps.registry.getSession(connId);
    if (!session || !session.room || !session.playerId) {
      this.deps.sendTo(connId, { type: 'error', message: '你还没有进入房间' });
      return;
    }
    session.room.returnToLobby();
    session.room.broadcastRoom();
  }

  private startGame(connId: string, mapId: string | undefined): void {
    const session = this.requireSession(connId);
    this.requireHost(session);
    const room = session.room!;
    room.start(mapId ?? room.mapId);
    room.broadcastRoom();
    room.broadcastStarting();
    room.armReadyTimeout();
  }

  // --- helpers -------------------------------------------------------------

  private requireSession(connId: string): Session {
    return this.deps.registry.requireSession(connId);
  }

  private requireHost(session: Session): void {
    if (!session.room || !session.playerId) throw new Error('你还没有进入房间');
    if (session.room.hostId !== session.playerId) throw new Error('只有房主可以这样做');
  }

  private connectionSend(connId: string): Send {
    return (msg) => this.deps.sendTo(connId, msg);
  }
}
