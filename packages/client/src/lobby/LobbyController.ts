/**
 * Lobby controller — owns lobby view state and dispatches lobby intents.
 *
 * Subscribes to socket events, keeps a `LobbyViewState` in sync with the
 * server's `RoomView`, and translates user intents into `ClientMessage`
 * payloads sent back to the server.
 *
 * The lobby launch countdown is a controller-level state machine so the
 * countdown survives in-flight re-renders.
 */
import type { RoomView, ServerMessage } from '@eldorado/core';
import type { ISocketPort, SocketEvent } from '../net/SocketPort.js';
import type { GameStore } from '../store/GameStore.js';
import { MAP_OPTIONS } from '@eldorado/core';
import {
  clearLaunchTimers,
  defaultMapOptions,
  renderLobby,
  type LobbyIntent,
  type LobbyMapOption,
  type LobbyPlayer,
  type LobbyViewEnv,
  type LobbyViewState,
} from './LobbyView.js';

const MAP_OPTION_IDS = new Set(MAP_OPTIONS.map((m) => m.id));
const DEFAULT_MAP_ID = MAP_OPTION_IDS.has('official-first') ? 'official-first' : 'classic';
const NAME_STORAGE_KEY = 'eldorado.name';
const MAP_STORAGE_KEY = 'eldorado.mapId';

function safeMapId(id: string | null | undefined): string {
  return id && MAP_OPTION_IDS.has(id) ? id : DEFAULT_MAP_ID;
}

export interface LobbyControllerDeps {
  socket: ISocketPort;
  mapOptions?: LobbyMapOption[];
  /**
   * Optional GameStore. When provided, the controller can read server-driven
   * state (room, phase, game) from the store. The store is updated by the
   * App's socket-event handler in parallel with the controller's own
   * message handler. Stage 5 wires the field in; future stages will
   * migrate the controller's state reads to the store.
   */
  store?: GameStore;
}

export class LobbyController {
  private readonly socket: ISocketPort;
  private readonly mapOptions: LobbyMapOption[];
  private readonly store: GameStore | undefined;
  private host: HTMLElement | null = null;
  private state: LobbyViewState = this.makeEntryState();
  private nameValue = localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  private selectedMapId = safeMapId(localStorage.getItem(MAP_STORAGE_KEY));
  private unsubscribe: (() => void) | null = null;

  constructor(deps: LobbyControllerDeps) {
    this.socket = deps.socket;
    this.mapOptions = deps.mapOptions ?? defaultMapOptions();
    this.store = deps.store;
    this.state.nameValue = this.nameValue;
    this.state.selectedMapId = this.selectedMapId;
  }

  /** Attach the lobby to a host element and start listening to socket events. */
  mount(host: HTMLElement): void {
    this.host = host;
    this.unsubscribe = this.socket.on((e) => this.onSocketEvent(e));
    this.render();
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.host = null;
    clearLaunchTimers();
  }

  /** Re-render the lobby using the current state. Safe to call from outside. */
  render(): void { this.renderImpl(); }

  /**
   * Called by the host App when the local user leaves the room.
   * Mirrors the legacy `endStarting(false) + clearRoomState + renderLobby` flow
   * without round-tripping through the server.
   */
  notifyLeftRoom(): void {
    clearLaunchTimers();
    this.state = this.makeEntryState();
    this.state.nameValue = this.nameValue;
    this.state.selectedMapId = this.selectedMapId;
    sessionStorage.removeItem('eldorado.session');
    this.state.selfId = null;
    this.renderImpl();
  }

  /**
   * Called by the host App when the room is force-closed (e.g. host left).
   * Clears the launch countdown and resets to entry state.
   */
  endStarting(): void {
    clearLaunchTimers();
    this.state.isLaunching = false;
    this.state.isStartingDone = false;
    this.renderImpl();
  }

  // --- socket handling ----------------------------------------------------

  private onSocketEvent(e: SocketEvent): void {
    if (e.kind !== 'message') return;
    this.onMessage(e.payload);
  }

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'joined':
        this.applyJoined(m.code, m.playerId);
        return;
      case 'room':
        this.applyRoom(m.room);
        return;
      case 'starting':
        this.state.startingPendingPlayers = m.pendingPlayers;
        this.render();
        return;
      case 'state':
        // When the server pushes the first game-state while we're still in
        // the launch countdown, mirror the legacy `endStarting(true)` path.
        if (this.state.isLaunching && this.state.isStartingDone) {
          clearLaunchTimers();
          this.state.isLaunching = false;
          this.state.isStartingDone = false;
        }
        return;
      case 'roomClosed':
        this.applyRoomClosed(m.message);
        return;
      case 'error':
        // Mirror the legacy 2.5s flash-and-clear.
        this.state.errorMessage = m.message;
        this.render();
        setTimeout(() => {
          if (this.state.errorMessage === m.message) {
            this.state.errorMessage = '';
            this.render();
          }
        }, 2500);
        return;
    }
  }

  private applyJoined(code: string, playerId: string): void {
    sessionStorage.setItem('eldorado.session', JSON.stringify({ code, playerId }));
    // The server will also send `room` immediately after `joined`; nothing to
    // do here other than track the player id (used by `isHost` checks).
    this.state.selfId = playerId;
  }

  private applyRoom(room: RoomView): void {
    const previousPhase = this.state.roomCode && this.state.players.length === 0
      ? 'playing'
      : this.isLobbyPhase(room)
        ? 'lobby'
        : 'playing';
    const nextPhase = room.phase;

    this.state.selfId = this.state.selfId ?? sessionPlayerId();
    this.state.roomCode = room.code;
    this.state.players = room.players as LobbyPlayer[];
    this.state.serverMapId = room.mapId;
    this.state.mapOptions = this.mapOptions;
    this.state.isHost = room.hostId === this.state.selfId;
    if (this.state.isHost) {
      this.selectedMapId = safeMapId(room.mapId);
      this.state.selectedMapId = this.selectedMapId;
      localStorage.setItem(MAP_STORAGE_KEY, this.selectedMapId);
    }

    if (nextPhase === 'lobby') {
      // Returning to lobby: clear launch overlay state.
      if (this.state.isLaunching) {
        clearLaunchTimers();
        this.state.isLaunching = false;
        this.state.isStartingDone = false;
      }
      this.state.isEntry = false;
      this.state.startingPendingPlayers = [];
      this.render();
    } else if (nextPhase === 'playing' && previousPhase === 'lobby') {
      // First time we see 'playing' after being in the lobby: enter launch
      // countdown. Mirror the legacy `beginStarting()` flow.
      this.beginStarting();
    } else if (nextPhase === 'playing') {
      // Already in 'playing' (e.g. after a rejoin); render the empty
      // players placeholder so the controller hides the lobby.
      this.state.isEntry = false;
      this.state.players = [];
      this.render();
    } else if (nextPhase === 'finished') {
      // Finished: hide the lobby, let the game-overlay layer handle the
      // return-to-lobby button.
      this.state.isEntry = false;
      this.state.players = [];
      this.render();
    }
  }

  private applyRoomClosed(_message: string): void {
    clearLaunchTimers();
    this.state = this.makeEntryState();
    this.state.nameValue = this.nameValue;
    this.state.selectedMapId = this.selectedMapId;
    this.state.errorMessage = '房间已解散';
    sessionStorage.removeItem('eldorado.session');
    this.state.selfId = null;
    this.render();
  }

  // --- launch flow --------------------------------------------------------

  private beginStarting(): void {
    if (this.state.isLaunching) return;
    this.state.isLaunching = true;
    this.state.isStartingDone = false;
    this.state.startingPendingPlayers = [];
    this.render();
  }

  // --- dispatch -----------------------------------------------------------

  private dispatch(intent: LobbyIntent): void {
    switch (intent.type) {
      case 'setName':
        this.nameValue = intent.name;
        localStorage.setItem(NAME_STORAGE_KEY, this.nameValue);
        this.state.nameValue = this.nameValue;
        this.render();
        return;
      case 'createRoom':
        this.socket.send({ type: 'createRoom', name: intent.name || '玩家' });
        // The legacy client followed the createRoom send with a setMap + setAiDelay.
        // Those are no-ops until the room exists, but we keep them here so
        // the server gets them on the same tick as `joined`.
        this.socket.send({ type: 'setMap', mapId: this.selectedMapId });
        return;
      case 'joinRoom':
        this.socket.send({ type: 'joinRoom', code: intent.code, name: intent.name || '玩家' });
        return;
      case 'leaveRoom':
        this.socket.send({ type: 'leaveRoom' });
        clearLaunchTimers();
        this.state = this.makeEntryState();
        this.state.nameValue = this.nameValue;
        this.state.selectedMapId = this.selectedMapId;
        sessionStorage.removeItem('eldorado.session');
        this.state.selfId = null;
        this.render();
        return;
      case 'addAI':
        this.socket.send({ type: 'addAI' });
        return;
      case 'removePlayer':
        this.socket.send({ type: 'removePlayer', playerId: intent.playerId });
        return;
      case 'setMap': {
        this.selectedMapId = safeMapId(intent.mapId);
        localStorage.setItem(MAP_STORAGE_KEY, this.selectedMapId);
        this.state.selectedMapId = this.selectedMapId;
        this.socket.send({ type: 'setMap', mapId: this.selectedMapId });
        this.render();
        return;
      }
      case 'startGame': {
        this.selectedMapId = safeMapId(intent.mapId);
        this.state.selectedMapId = this.selectedMapId;
        this.beginStarting();
        this.socket.send({ type: 'startGame', mapId: this.selectedMapId });
        return;
      }
      case 'launchComplete': {
        this.state.isStartingDone = true;
        // Send the ready message so the server can clear the barrier.
        this.socket.send({ type: 'ready' });
        this.render();
        return;
      }
      case 'updatePending':
        this.state.startingPendingPlayers = intent.pendingPlayers;
        this.render();
        return;
    }
  }

  // --- helpers ------------------------------------------------------------

  private makeEntryState(): LobbyViewState {
    return {
      isEntry: true,
      isLaunching: false,
      isStartingDone: false,
      startingPendingPlayers: [],
      selfId: null,
      roomCode: null,
      players: [],
      mapOptions: this.mapOptions,
      selectedMapId: this.selectedMapId,
      serverMapId: null,
      isHost: false,
      nameValue: this.nameValue,
      errorMessage: '',
    };
  }

  private isLobbyPhase(room: RoomView): boolean {
    return room.phase === 'lobby';
  }

  private renderImpl(): void {
    if (!this.host) return;
    const env: LobbyViewEnv = { dispatch: (i) => this.dispatch(i) };
    renderLobby(this.host, this.state, env);
  }
}

function sessionPlayerId(): string | null {
  const saved = sessionStorage.getItem('eldorado.session');
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as { playerId?: string };
    return parsed.playerId ?? null;
  } catch {
    return null;
  }
}