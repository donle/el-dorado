/**
 * GameStore — observable state holder for server-driven client state.
 *
 * The store translates `ServerMessage` events into state transitions via a
 * pure reducer. UI components subscribe to receive state updates.
 *
 * Scope (Stage 5): server-driven state only — phase, room, game, and the
 * transient error/roomClosed messages. Local UI state (selection, mode,
 * mobile panel, hints, etc.) stays in the App class for now.
 */
import type { GameState, Phase, RoomView, ServerMessage } from '@eldorado/core';

export interface GameStoreState {
  phase: Phase;
  room: RoomView | null;
  /** The most recent game state from a 'state' message. */
  game: GameState | null;
  /** Transient error message (mirrors ServerMessage 'error'). */
  errorMessage: string | null;
  /** When set, the local player has been kicked from the room. */
  roomClosedMessage: string | null;
}

export type GameStoreListener = (state: GameStoreState) => void;

const INITIAL: GameStoreState = {
  phase: 'lobby',
  room: null,
  game: null,
  errorMessage: null,
  roomClosedMessage: null,
};

export class GameStore {
  private state: GameStoreState = INITIAL;
  private listeners = new Set<GameStoreListener>();

  getState(): GameStoreState {
    return this.state;
  }

  subscribe(fn: GameStoreListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Apply a server message. Mutates state, notifies subscribers. */
  dispatch(msg: ServerMessage): void {
    const next = reduce(this.state, msg);
    if (next !== this.state) {
      this.state = next;
      for (const l of this.listeners) l(next);
    }
  }

  /** Reset to the initial state (e.g. after returning to lobby). */
  reset(): void {
    if (this.state === INITIAL) return;
    this.state = INITIAL;
    for (const l of this.listeners) l(this.state);
  }

  /**
   * Manually patch a state field. Used by App for derived state updates
   * that don't originate from a `ServerMessage`.
   */
  patch(partial: Partial<GameStoreState>): void {
    this.state = { ...this.state, ...partial };
    for (const l of this.listeners) l(this.state);
  }
}

function reduce(state: GameStoreState, msg: ServerMessage): GameStoreState {
  switch (msg.type) {
    case 'joined':
      // 'joined' is a confirmation; the 'room' message usually follows.
      return state;
    case 'room':
      return {
        ...state,
        room: msg.room,
        phase: msg.room.phase,
        errorMessage: null,
        roomClosedMessage: null,
      };
    case 'state':
      return {
        ...state,
        game: msg.state,
        phase: 'playing',
        errorMessage: null,
      };
    case 'starting':
      // Launch countdown — handled by LobbyController, not stored here.
      return state;
    case 'error':
      return { ...state, errorMessage: msg.message };
    case 'roomClosed':
      return {
        ...state,
        roomClosedMessage: msg.message,
        room: null,
        phase: 'lobby',
      };
  }
}
