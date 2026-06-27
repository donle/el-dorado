/**
 * controllers/SessionController — owns session-level lifecycle: socket-event
 * dispatch, rejoin-on-reconnect, leave-room, return-to-lobby, room-closed
 * handler, and the in-game state-reset that runs on every transition.
 *
 * Extracted from the App god class so the methods that bridge network
 * events to UI state changes live in one place. The controller does NOT
 * own the App's `state` / `room` / `you` fields — it writes them through
 * the host interface, which keeps it from becoming its own god class.
 */
import type {
  ClientMessage,
  GameEvent,
  GameState,
  RoomView,
  ServerMessage,
} from '@eldorado/core';
import type { SocketEvent } from '../net/SocketPort.js';

export type MobilePanel = 'players' | 'market' | 'log' | null;

type BoughtEvent = Extract<GameEvent, { type: 'bought' }>;
type JoinedMessage = Extract<ServerMessage, { type: 'joined' }>;
type RoomMessage = Extract<ServerMessage, { type: 'room' }>;
type StateMessage = Extract<ServerMessage, { type: 'state' }>;

export interface SessionHost {
  // --- Writable state slots ------------------------------------------
  state: GameState | null;
  room: RoomView | null;
  you: string | null;
  mobilePanel: MobilePanel;
  /** Toast slot the HUD renders; flipped + cleared by `onError`. */
  error: string;

  // --- Subsystems ---------------------------------------------------
  readonly net: { send(msg: ClientMessage): void };
  readonly board: {
    setSelfPlayerId(id: string | null): void;
    setHighlights(highlights: unknown[]): void;
    setBlockadeHighlights(highlights: unknown[]): void;
    setInspectedHex(coord: unknown): void;
    setInspectedBlockade(id: string | null): void;
    panToPlayerIfOffscreen(id: string | null): void;
  };
  readonly hoverMachine: { closeTerrainPanel(): void };
  readonly overlays: { showSystemDialog(title: string, message: string): void };
  readonly interaction: {
    marketPreviewDefId: string | null;
    resetSelection(): void;
    syncSelectionToState(): void;
  };
  readonly actionLogPanel: {
    resetActionLog(): void;
    rememberCards(state: GameState | null): void;
    appendActionLog(events: GameEvent[], state: GameState, previousState: GameState | null): void;
  };
  /** Close the pinned-player hand inspector (C4 dep — TODO.md C4). */
  readonly playerHandCtl: { close(): void };
  readonly lobbyCtl: { endStarting(): void; render(): void; notifyLeftRoom(): void };
  readonly boardCtl: {
    clearTurnIntro(): void;
    showTurnIntro(): void;
    enterGameView(): void;
    animateBuy(playerId: string, defId: string, source?: DOMRect): void;
    shouldShowTurnIntro(
      previousState: GameState | null,
      nextState: GameState,
      events: GameEvent[],
    ): boolean;
  };
  /** Map of market slot DOM elements keyed by card defId (used to capture
   *  source rects for the buy animation, BEFORE the HUD rebuilds). */
  readonly shopEls: ReadonlyMap<string, HTMLElement>;

  // --- Entry points -------------------------------------------------
  /** Forwarded by the App's thin `onMessage` shell (C6). */
  onMessage(m: ServerMessage): void;
  /** Re-render HUD. Lobby re-render goes through `lobbyCtl.render()` directly. */
  renderHud(): void;
}

export class SessionController {
  constructor(private readonly host: SessionHost) {}

  // --- socket-event dispatch -----------------------------------------

  onSocketEvent(e: SocketEvent): void {
    if (e.kind === 'open') this.rejoinSavedSession();
    else if (e.kind === 'message') this.host.onMessage(e.payload);
    // 'close' / 'error' have no in-app handler (adapter drives reconnect).
  }

  // --- session lifecycle ---------------------------------------------

  rejoinSavedSession(): void {
    const saved = sessionStorage.getItem('eldorado.session');
    if (!saved) return;
    try {
      const { code, playerId } = JSON.parse(saved) as { code?: string; playerId?: string };
      if (code && playerId) this.host.net.send({ type: 'rejoin', code, playerId });
    } catch {
      sessionStorage.removeItem('eldorado.session');
    }
  }

  leaveRoom(): void {
    if (this.host.room || this.host.you) this.host.net.send({ type: 'leaveRoom' });
    this.clearRoomState();
    this.host.lobbyCtl.notifyLeftRoom();
    this.host.renderHud();
  }

  returnToLobby(): void {
    this.host.net.send({ type: 'returnToLobby' });
  }

  onRoomClosed(message: string): void {
    this.host.lobbyCtl.endStarting();
    this.clearRoomState();
    this.host.lobbyCtl.render();
    this.host.renderHud();
    this.host.overlays.showSystemDialog('房间已解散', message);
  }

  clearRoomState(): void {
    this.host.boardCtl.clearTurnIntro();
    sessionStorage.removeItem('eldorado.session');
    this.host.you = null;
    this.host.room = null;
    this.host.state = null;
    this.host.actionLogPanel.resetActionLog();
    this.host.interaction.resetSelection();
    this.host.playerHandCtl.close();
    this.host.mobilePanel = null;
    this.host.board.setSelfPlayerId(null);
    this.host.board.setHighlights([]);
    this.host.board.setBlockadeHighlights([]);
    this.host.board.setInspectedHex(null);
    this.host.board.setInspectedBlockade(null);
    this.host.hoverMachine.closeTerrainPanel();
  }

  closeMobilePanel(): void {
    this.host.mobilePanel = null;
    this.host.interaction.marketPreviewDefId = null;
    this.host.renderHud();
  }

  // --- per-message handlers (C6 extraction) --------------------------

  onJoined(m: JoinedMessage): void {
    this.host.you = m.playerId;
    this.host.board.setSelfPlayerId(m.playerId);
    sessionStorage.setItem(
      'eldorado.session',
      JSON.stringify({ code: m.code, playerId: m.playerId }),
    );
  }

  onRoom(m: RoomMessage): void {
    this.host.room = m.room;
    if (m.room.phase === 'lobby') {
      this.host.boardCtl.clearTurnIntro();
      this.host.state = null;
      this.host.actionLogPanel.resetActionLog();
      this.host.interaction.resetSelection();
      this.host.board.setHighlights([]);
      this.host.board.setBlockadeHighlights([]);
      this.host.renderHud();
    }
  }

  onStateUpdate(m: StateMessage): void {
    const previousState = this.host.state;
    const buys = (m.events ?? []).filter((e): e is BoughtEvent => e.type === 'bought');
    // Capture market source rects BEFORE the HUD is rebuilt.
    const sources = new Map<string, DOMRect>();
    for (const e of buys) {
      const node = this.host.shopEls.get(e.defId);
      // start from the card-face thumbnail (card-shaped), not the whole row
      const thumb = node?.querySelector('.card-thumb') ?? node;
      if (thumb) sources.set(`${e.defId}|${e.playerId}`, thumb.getBoundingClientRect());
    }
    this.host.actionLogPanel.rememberCards(previousState);
    this.host.actionLogPanel.rememberCards(m.state);
    this.host.actionLogPanel.appendActionLog(m.events ?? [], m.state, previousState);
    const shouldShowTurnIntro = this.host.boardCtl.shouldShowTurnIntro(
      previousState,
      m.state,
      m.events ?? [],
    );
    const turnPlayerChanged = !!previousState
      && previousState.turn?.playerId !== m.state.turn?.playerId;
    this.host.state = m.state;
    this.host.interaction.syncSelectionToState();
    this.host.boardCtl.enterGameView();
    if (turnPlayerChanged) this.host.board.panToPlayerIfOffscreen(m.state.turn?.playerId ?? null);
    if (shouldShowTurnIntro) this.host.boardCtl.showTurnIntro();
    for (const e of buys) {
      this.host.boardCtl.animateBuy(
        e.playerId,
        e.defId,
        sources.get(`${e.defId}|${e.playerId}`),
      );
    }
  }

  onError(message: string): void {
    this.host.error = message;
    this.host.renderHud();
    setTimeout(() => {
      if (this.host.error === message) {
        this.host.error = '';
        this.host.renderHud();
      }
    }, 2500);
  }
}
