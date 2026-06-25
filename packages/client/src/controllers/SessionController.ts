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
import type { ClientMessage, GameState, RoomView, ServerMessage } from '@eldorado/core';
import type { SocketEvent } from '../net/SocketPort.js';

export type MobilePanel = 'players' | 'market' | 'log' | null;

export interface SessionHost {
  // --- Writable state slots ------------------------------------------
  state: GameState | null;
  room: RoomView | null;
  you: string | null;
  mobilePanel: MobilePanel;

  // --- Subsystems ---------------------------------------------------
  readonly net: { send(msg: ClientMessage): void };
  readonly board: {
    setSelfPlayerId(id: string | null): void;
    setHighlights(highlights: unknown[]): void;
    setBlockadeHighlights(highlights: unknown[]): void;
    setInspectedHex(coord: unknown): void;
    setInspectedBlockade(id: string | null): void;
  };
  readonly hoverMachine: { closeTerrainPanel(): void };
  readonly overlays: { showSystemDialog(title: string, message: string): void };
  readonly interaction: {
    marketPreviewDefId: string | null;
    resetSelection(): void;
  };
  readonly actionLogPanel: { resetActionLog(): void };
  /** Close the pinned-player hand inspector (C4 dep — TODO.md C4). */
  readonly playerHandCtl: { close(): void };
  readonly lobbyCtl: { endStarting(): void; render(): void; notifyLeftRoom(): void };
  readonly boardCtl: { clearTurnIntro(): void };

  // --- Entry points -------------------------------------------------
  /** Pass-through to App.onMessage (the dispatcher switch). */
  onMessage(m: ServerMessage): void;
  /** Re-render HUD + Lobby. */
  renderHud(): void;
  renderLobby(): void;
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
}