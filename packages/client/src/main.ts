import './style.css';
import { WebSocketAdapter } from './net/WebSocketAdapter.js';
import type { ISocketPort, SocketEvent } from './net/SocketPort.js';
import { BootController } from './boot/BootController.js';
import { LobbyController } from './lobby/LobbyController.js';
import { GameStore } from './store/GameStore.js';
import { el } from './views/common/dom.js';
// renderHud body lives in controllers/HudRenderer.ts (G4 extraction).
import {
  clearTurnIntro as clearTurnIntroOverlay,
  showTurnIntro as showTurnIntroOverlay,
} from './views/overlays/TurnIntroOverlay.js';
import {
  findCardDefId,
  fallbackCardDefId,
  type GameState,
  type RoomView,
  type ClientMessage,
  type ServerMessage,
  type Hex,
  type Axial,
  type Action,
  type Blockade,
} from '@eldorado/core';

type BoardConstructor = typeof import('./scene/Board.js').Board;
type BoardInstance = InstanceType<BoardConstructor>;

import { MobileLayoutProbe } from './controllers/MobileLayoutProbe.js';
import { HoverStateMachine } from './controllers/HoverStateMachine.js';
import { ActionLogPanel } from './controllers/ActionLogPanel.js';
import { createHoverHost } from './controllers/HoverHost.js';
import { InteractionController } from './controllers/InteractionController.js';
import { BoardCoordinator } from './controllers/BoardCoordinator.js';
import { PlayerHandPanel } from './controllers/PlayerHandPanel.js';
import { OverlaysController } from './controllers/OverlaysController.js';
import { SettingsMenuController } from './controllers/SettingsMenuController.js';
import { SessionController } from './controllers/SessionController.js';
import { CardPreviewController } from './controllers/CardPreviewController.js';
import { HudRenderer, type HudDomRefs } from './controllers/HudRenderer.js';

class App {
  net: ISocketPort = new WebSocketAdapter(WebSocketAdapter.defaultUrl());
  board: BoardInstance;
  you: string | null = null;
  room: RoomView | null = null;
  state: GameState | null = null;

  // interaction state lives in InteractionController (B3 extraction).
  // `readonly` (not `private`) so SessionController's host interface
  // (see controllers/SessionController.ts) can reach `marketPreviewDefId`
  // and `resetSelection()` through App during clearRoomState / closeMobilePanel.
  readonly interaction!: InteractionController;
  // view-level orchestration (enter game view, turn intro, buy animation)
  // lives in BoardCoordinator (B4 extraction).
  // `readonly` (not `private`) so SessionController's host interface
  // can call `clearTurnIntro()` during clearRoomState.
  readonly boardCtl!: BoardCoordinator;
  // pinned-player hand inspector state + DOM (C1 extraction).
  // `readonly` (not `private`) so SessionController's host interface can
  // call `close()` to drop the pinned state on leaveRoom / onRoomClosed.
  readonly playerHandCtl!: PlayerHandPanel;
  // transient-UI overlays: flash / system dialog / sheet dismiss / game-over (C2)
  /** @internal SessionController + renderGameOverOverlay. */
  readonly overlays!: OverlaysController;
  // in-game settings menu (view mode + AI delay + exit) (C3 extraction)
  /** @internal HudRenderer + SettingsMenuController. */
  readonly settingsCtl!: SettingsMenuController;
  // session lifecycle: socket events, leave/return, room reset (C4 extraction)
  private sessionCtl!: SessionController;

  // HoverHost accessors (consumed by HoverStateMachine) live in
  // controllers/HoverHost.ts — App just calls `createHoverHost(this)`
  // and passes the result to `new HoverStateMachine(...)`.

  // --- ActionLogHost accessors (consumed by ActionLogPanel) ---
  /** @internal ActionLogPanel */
  findCardDefId(cardId: string, state: GameState): string | null { return findCardDefId(cardId, state); }
  /** @internal ActionLogPanel */
  fallbackCardDefId(cardId: string): string { return fallbackCardDefId(cardId); }

  viewMode: '3d' | '2d' = localStorage.getItem('eldorado.viewMode') === '2d' ? '2d' : '3d';
  /** Host's preferred per-action AI delay in ms lives in SettingsMenuController (C3). */
  error = '';
  /** Which mobile overlay is open (null = none). */
  mobilePanel: 'players' | 'market' | 'log' | null = null;
  // settingsOpen lives in SettingsMenuController (C3 extraction).
  // systemDialog moved to OverlaysController (C2 extraction).

  /** @internal OverlaysController reads `hud` to mount the game-over overlay. */
  readonly hud = document.getElementById('hud') as HTMLDivElement;
  private store = new GameStore();
  // `readonly` (not `private`) so SessionController's host interface
  // can call `endStarting()` / `render()` / `notifyLeftRoom()` during
  // leaveRoom / onRoomClosed.
  readonly lobbyCtl = new LobbyController({ socket: this.net, store: this.store });
  private terrainPanel = el('div', 'terrain-panel inspector-popover panel hidden');
  /** @internal HudRenderer owns these; exposed here so CardPreviewController /
   *  BoardCoordinator / SessionController can keep reading through `this.app`. */
  get handEls(): Map<string, HTMLElement> { return this.dom.handEls; }
  get shopEls(): Map<string, HTMLElement> { return this.dom.shopEls; }
  get playerCardEls(): Map<string, HTMLElement> { return this.dom.playerCardEls; }
  get drawPileEl(): HTMLElement | null { return this.dom.drawPileEl; }
  set drawPileEl(el: HTMLElement | null) { this.dom.drawPileEl = el; }
  get discardPileEl(): HTMLElement | null { return this.dom.discardPileEl; }
  set discardPileEl(el: HTMLElement | null) { this.dom.discardPileEl = el; }
  // playerHandPanel + pinnedPlayerId live in PlayerHandPanel (C1 extraction).
  /** @internal ActionLogPanel needs the isMobileDevice gate. */
  readonly mobileLayout: MobileLayoutProbe = new MobileLayoutProbe();
  /** @internal ActionLogPanel needs the showLogTerrainPreview entry point. */
  readonly hoverMachine: HoverStateMachine = undefined!;
  // `readonly` (not `private`) so SessionController's host interface
  // can call `resetActionLog()` during clearRoomState.
  readonly actionLogPanel!: ActionLogPanel;
  /** Card preview popover subsystem (G3 extraction). */
  readonly previewCtl: CardPreviewController = undefined!;
  /** HUD composition pipeline (G4 extraction). */
  readonly hudRenderer: HudRenderer = undefined!;
  /** DOM maps the HudRenderer fills; BoardCoordinator reads them for buy animation. */
  readonly dom: HudDomRefs = {
    handEls: new Map<string, HTMLElement>(),
    shopEls: new Map<string, HTMLElement>(),
    playerCardEls: new Map<string, HTMLElement>(),
    drawPileEl: null,
    discardPileEl: null,
  };

  constructor(BoardClass: BoardConstructor) {
    this.mobileLayout.setupMobileLayoutClasses();
    document.body.appendChild(this.terrainPanel);
    this.board = new BoardClass(document.getElementById('board') as HTMLCanvasElement);
    (window as unknown as { __board: BoardInstance }).__board = this.board;
    (window as unknown as { __app: App }).__app = this;
    this.board.setViewMode(this.viewMode);
    this.previewCtl = new CardPreviewController(this);
    this.hoverMachine = new HoverStateMachine(this.terrainPanel, createHoverHost(this));
    this.actionLogPanel = new ActionLogPanel(this);
    this.interaction = new InteractionController(this);
    this.boardCtl = new BoardCoordinator(this);
    this.playerHandCtl = new PlayerHandPanel(this);
    this.overlays = new OverlaysController(this);
    this.settingsCtl = new SettingsMenuController(this);
    this.sessionCtl = new SessionController(this);
    this.hudRenderer = new HudRenderer(this);
    this.board.onHexHover = (c) => this.hoverMachine.onHexHover(c);
    this.board.onHexClick = (c) => this.hoverMachine.onHexClick(c);
    this.board.onBlockadeHover = (id) => this.hoverMachine.onBlockadeHover(id);
    this.board.onBlockadeClick = (id) => this.hoverMachine.onBlockadeClick(id);
    this.net.on((e) => this.sessionCtl.onSocketEvent(e));
    this.lobbyCtl.mount(document.getElementById('lobby') as HTMLDivElement);
  }

  // --- networking ---

  // onSocketEvent lives in SessionController (C4 extraction).

  // C6: thin shell — store dispatch + dispatch to SessionController.
  // All case bodies live in controllers/SessionController.ts.
  onMessage(m: ServerMessage): void {
    // Mirror every server message into the store so other components can
    // subscribe. The App's local UI state (this.room / this.state / etc.)
    // remains the source of truth for the existing code paths — the store
    // is a parallel observable for future refactors (Stage 5.x).
    this.store.dispatch(m);
    switch (m.type) {
      case 'joined':       this.sessionCtl.onJoined(m); break;
      case 'room':         this.sessionCtl.onRoom(m); break;
      case 'state':        this.sessionCtl.onStateUpdate(m); break;
      case 'roomClosed':   this.sessionCtl.onRoomClosed(m.message); break;
      case 'error':        this.sessionCtl.onError(m.message); break;
    }
  }

  /** @internal InteractionController → server */
  act(action: Action): void {
    this.net.send({ type: 'action', action });
  }

  // rejoinSavedSession lives in SessionController (C4 extraction).

  // --- helpers ---

  /** @internal App → HoverStateMachine */
  get me() {
    return this.state?.players.find((p) => p.id === this.you) ?? null;
  }
  // HoverStateMachine (controllers/HoverStateMachine.ts) reads these via
  // the HoverHost interface. They migrate to InteractionController in B3;
  // keeping the call sites stable is what matters.
  /** @internal App → HoverStateMachine */
  isMyTurn(): boolean {
    return !!this.state && this.state.phase === 'playing' && this.state.turn?.playerId === this.you;
  }

  /** @internal CardPreviewController uses this to branch actionable market preview. */
  marketNeedsPromotion(state: GameState): boolean {
    return this.interaction.marketNeedsPromotion(state);
  }
  /** @internal InteractionController */
  setMobilePanel(p: 'players' | 'market' | 'log' | null): void { this.mobilePanel = p; }
  /** @internal InteractionController */
  sendAction(action: Action): void { this.act(action); }
  /** @internal SettingsMenuController (setAiDelay) */
  send(msg: ClientMessage): void { this.net.send(msg); }
  /** @internal InteractionController */
  renderTerrainPanel(): void { this.hoverMachine.renderTerrainPanel(); }
  /** @internal App → App.onMessage */
  syncSelectionToState(): void { this.interaction.syncSelectionToState(); }
  /** @internal App → HoverStateMachine */
  hexAt(c: Axial): Hex | undefined {
    return this.state?.hexes.find((h) => h.q === c.q && h.r === c.r);
  }

  /** @internal App → HoverStateMachine */
  blockadeById(id: string | null): Blockade | undefined {
    return id ? this.state?.blockades.find((b) => b.id === id) : undefined;
  }

  /** @internal OverlaysController (game-over overlay button) — forwards to SessionController. */
  leaveRoom(): void { this.sessionCtl.leaveRoom(); }

  /** Expose the server-driven state slice for subscribers (other controllers, views). */
  getStore(): GameStore {
    return this.store;
  }

  // clearRoomState lives in SessionController (C4 extraction).
  // shouldShowTurnIntro / showTurnIntro / clearTurnIntro / enterGameView /
  // animateBuy / resetSelection / syncSelectionToState live in their
  // respective controllers (C6 extraction — App.onMessage is a thin shell
  // that dispatches to SessionController, which calls boardCtl /
  // interaction directly through the host interface).

  /** @internal OverlaysController (game-over overlay button) — forwards to SessionController. */
  returnToLobby(): void { this.sessionCtl.returnToLobby(); }

  /** @internal OverlaysController (after system dialog dismissal). */
  renderLobby(): void {
    this.lobbyCtl.render();
  }

  // onRoomClosed lives in SessionController (C4 extraction).

  // --- action log: see controllers/ActionLogPanel.ts ---

  // --- selection sync + movement legality live in InteractionController (B3) ---

  recomputeHighlights(): void {
    this.interaction.recomputeHighlights();
  }

  // --- input ---
  // Board hover/click handlers and all interaction dispatch (tryActOnHex,
  // tryActOnBlockade, onCardClick, onMarketClick, …) live in
  // controllers/InteractionController.ts (B3 extraction). Thin forwarders
  // are kept above for HoverStateMachine and the renderer.

  // --- selection / input dispatch lives in InteractionController (B3) ---

  /** @internal OverlaysController (sheet-dismiss) + renderHud (scrim click) — forwards. */
  closeMobilePanel(): void { this.sessionCtl.closeMobilePanel(); }

  // toggleViewMode / setViewMode / toggleSettings / renderSettingsMenu live in SettingsMenuController (C3).

  // flash + flashTimer + attachSheetDismiss + renderGameOverOverlay live in OverlaysController (C2).

  /** @internal InteractionController — forwards to OverlaysController. */
  flash(msg: string): void {
    this.overlays.flash(msg);
  }

  // --- piles & buy animation live in BoardCoordinator (B4) ---

  /** @internal HudRenderer builds draw/discard piles through this. */
  makePile(kind: 'draw' | 'discard', label: string, count: number): HTMLElement {
    return this.boardCtl.makePile(kind, label, count);
  }

  // flyCard / animateBuy live in BoardCoordinator (B4). C6 — SessionController
  // calls boardCtl.animateBuy directly through the host interface, so the
  // App forwarders are no longer needed.

  // attachSheetDismiss lives in OverlaysController (C2 extraction).

  // --- card preview subsystem lives in CardPreviewController (G3 extraction) ---

  // --- player hand inspector lives in PlayerHandPanel (C1 extraction) ---

  // Lobby rendering moved to packages/client/src/lobby/LobbyView.ts; App no
  // longer owns the lobby element. App only renders the in-game HUD.
  // --- rendering: HUD ---
  // renderHud body lives in controllers/HudRenderer.ts (G4 extraction).
  // Action-log desktop panel + mobile dialog live in ActionLogPanel
  // (renderInto / renderMobileDialog).

  renderHud(): void {
    this.hudRenderer.render();
  }

  // renderGameOverOverlay lives in OverlaysController (C2 extraction).

  // --- terrain / blockade hover & panel: see controllers/HoverStateMachine.ts
}

// --- small DOM helpers ---

// terrainInfo / blockadeInfo / blockadeTerrain / terrainCostText / blockadeCostText
// moved to controllers/TerrainInfo.ts (G2 extraction).
// cardDescription / previewHtml / marketInlineDetailHtml moved to views/cards/CardDescription.ts.

async function preloadGameEngine(boot: BootController): Promise<BoardConstructor> {
  boot.markEngineLoading();
  const mod = await import('./scene/Board.js');
  boot.markUiInitializing();
  return mod.Board;
}

async function start(): Promise<void> {
  const boot = new BootController();
  await boot.run();
  const BoardClass = await preloadGameEngine(boot);
  new App(BoardClass);
  requestAnimationFrame(() => boot.hide());
}

void start();
