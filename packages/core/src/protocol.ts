/** Wire protocol shared by server and client. */
import type { GameState, PlayerColor } from './types.js';
import type { Action, GameEvent } from './actions.js';

export interface RoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  connected: boolean;
  /** Human seat currently controlled by AI because the player left/disconnected. */
  offline?: boolean;
}

export interface RoomView {
  code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'finished';
  mapId: string;
  aiDelayMs: number;
  players: RoomPlayer[];
}

export type ClientMessage =
  | { type: 'createRoom'; name: string }
  | { type: 'joinRoom'; code: string; name: string }
  | { type: 'rejoin'; code: string; playerId: string }
  | { type: 'addAI' }
  | { type: 'removePlayer'; playerId: string }
  | { type: 'setMap'; mapId: string }
  | { type: 'startGame'; mapId?: string }
  | { type: 'leaveRoom' }
  | { type: 'returnToLobby' }
  | { type: 'setAiDelay'; ms: number }
  | { type: 'action'; action: Action };

export type ServerMessage =
  | { type: 'joined'; code: string; playerId: string }
  | { type: 'room'; room: RoomView }
  | { type: 'state'; state: GameState; events?: GameEvent[] }
  | { type: 'roomClosed'; message: string }
  | { type: 'error'; message: string };
