import './style.css';
import { WebSocketAdapter } from './net/WebSocketAdapter.js';
import type { ISocketPort } from './net/SocketPort.js';
import { BootController } from './boot/BootController.js';
import { LobbyController } from './lobby/LobbyController.js';
import { GameStore } from './store/GameStore.js';
import { el } from './views/common/dom.js';
import {
  type Action,
  type GameState,
  type RoomView,
  type ServerMessage,
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
  // `readonly` (not `private`) so other controllers' host interfaces
  // (OverlaysHost / SettingsMenuHost / HudHost / ActionLogHost) can call
  // closeMobilePanel / leaveRoom / returnToLobby directly.
  readonly sessionCtl!: SessionController;

  // HoverHost accessors (consumed by HoverStateMachine) live in
  // controllers/HoverHost.ts — App just calls `createHoverHost(this)`
  // and passes the result to `new HoverStateMachine(...)`.

  // card-def lookup for ActionLogPanel moved to @eldorado/core import
  // (G6 — see ActionLogPanel.cardDefIdForLog).

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

  /** The current player (state lookup). Used by InteractionController + BoardCoordinator. */
  get me() {
    return this.state?.players.find((p) => p.id === this.you) ?? null;
  }
  /** Phase + turn gate. Used by InteractionController + ActionLogPanel. */
  isMyTurn(): boolean {
    return !!this.state && this.state.phase === 'playing' && this.state.turn?.playerId === this.you;
  }

  // Other small accessors that used to live here were inlined into the
  // respective host adapters in Stage G6:
  //   - HoverHost.ts reads `state` / `you` directly (hexAt / blockadeById
  //     gone from App).
  //   - InteractionController writes `host.mobilePanel = …` directly and
  //     calls `host.act` / `host.hoverMachine.renderTerrainPanel` /
  //     `host.overlays.flash` (setMobilePanel / sendAction /
  //     renderTerrainPanel / flash gone from App).
  //   - BoardCoordinator calls `host.interaction.recomputeHighlights()`
  //     (recomputeHighlights gone from App).
  //   - SessionController calls `host.interaction.syncSelectionToState()`
  //     (syncSelectionToState gone from App).
  //   - OverlaysController reaches `host.lobbyCtl.render()` and
  //     `host.sessionCtl.{closeMobilePanel, leaveRoom, returnToLobby}`
  //     (renderLobby / leaveRoom / returnToLobby / closeMobilePanel gone
  //     from App).
  //   - SettingsMenuController calls `host.net.send` and
  //     `host.sessionCtl.leaveRoom` (send / leaveRoom gone from App).
  //   - CardPreviewController reads `host.interaction.marketNeedsPromotion`
  //     (marketNeedsPromotion gone from App).
  //   - HudRenderer reads `host.boardCtl.makePile` /
  //     `host.sessionCtl.closeMobilePanel` and computes isMyTurn / hexAt /
  //     blockadeById inline from `state` / `you`.
  //   - getStore / findCardDefId / fallbackCardDefId were removed because
  //     they had no callers (or could be inlined from @eldorado/core).

  // --- input ---
  // Board hover/click handlers and all interaction dispatch (tryActOnHex,
  // tryActOnBlockade, onCardClick, onMarketClick, …) live in
  // controllers/InteractionController.ts (B3 extraction).

  // --- HUD rendering ---
  // renderHud body lives in controllers/HudRenderer.ts (G4 extraction).
  // Action-log desktop panel + mobile dialog live in ActionLogPanel
  // (renderInto / renderMobileDialog).

  renderHud(): void {
    this.hudRenderer.render();
  }
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
