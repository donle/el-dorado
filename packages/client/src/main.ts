import './style.css';
import { WebSocketAdapter } from './net/WebSocketAdapter.js';
import type { ISocketPort, SocketEvent } from './net/SocketPort.js';
import { BootController } from './boot/BootController.js';
import { LobbyController } from './lobby/LobbyController.js';
import { GameStore } from './store/GameStore.js';
import { KIND_LABEL, SYMBOL_GLYPH, SYMBOL_LABEL } from './views/common/iconMap.js';
import { button, cardBack, colorHex, el, escapeHtml, playerDisplayName } from './views/common/dom.js';
import { renderHandPanel } from './views/hand/HandPanel.js';
import { renderMarketPanel } from './views/market/MarketPanel.js';
import { renderPlayerBar } from './views/players/PlayerBar.js';
import { renderTurnInfoPanel, type ActionCardPrompt } from './views/turn/TurnInfoPanel.js';
import { buildGearDock, buildTopBar, buildMobileToolbar } from './views/hud/ChromeBars.js';
import { previewHtml, marketInlineDetailHtml } from './views/cards/CardDescription.js';
import {
  clearTurnIntro as clearTurnIntroOverlay,
  showTurnIntro as showTurnIntroOverlay,
} from './views/overlays/TurnIntroOverlay.js';
// renderGameOverOverlayEl moved into OverlaysController (C2 extraction).
import {
  getDef,
  CARD_DEFS,
  HAND_SIZE,
  movableSymbols,
  coinValue,
  neighbors,
  isAdjacent,
  pickHandMover,
  progressOf,
  terrainSymbol,
  blockadeMoveSymbol,
  blockadeRequiresDiscard,
  cardDefId,
  findCardDefId,
  fallbackCardDefId,
  type GameState,
  type RoomView,
  type ClientMessage,
  type ServerMessage,
  type Hex,
  type Axial,
  type MoveSymbol,
  type Terrain,
  type Action,
  type Blockade,
  type GameEvent,
} from '@eldorado/core';

type BoardConstructor = typeof import('./scene/Board.js').Board;
type BoardInstance = InstanceType<BoardConstructor>;

import { MobileLayoutProbe } from './controllers/MobileLayoutProbe.js';
import { HoverStateMachine, type Mode } from './controllers/HoverStateMachine.js';
import { ActionLogPanel, type ActionLogEntry, type ActionLogSegment } from './controllers/ActionLogPanel.js';
import { InteractionController } from './controllers/InteractionController.js';
import { BoardCoordinator } from './controllers/BoardCoordinator.js';
import { PlayerHandPanel } from './controllers/PlayerHandPanel.js';
import { OverlaysController } from './controllers/OverlaysController.js';
import { SettingsMenuController } from './controllers/SettingsMenuController.js';
import { SessionController } from './controllers/SessionController.js';

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
  private settingsCtl!: SettingsMenuController;
  // session lifecycle: socket events, leave/return, room reset (C4 extraction)
  private sessionCtl!: SessionController;

  // --- HoverHost accessors (consumed by HoverStateMachine) ---
  // Thin getters / module-helper wrappers so HoverStateMachine doesn't
  // need direct access to private App fields or module-level functions.
  /** @internal HoverStateMachine */
  getState(): GameState | null { return this.state; }
  /** @internal HoverStateMachine */
  getMobilePanel(): 'players' | 'market' | 'log' | null { return this.mobilePanel; }
  /** @internal HoverStateMachine */
  getMode(): Mode { return this.interaction.mode; }
  /** @internal HoverStateMachine */
  getSelected(): Set<string> { return this.interaction.selected; }
  /** @internal HoverStateMachine */
  getNativeActionCardId(): string | null { return this.interaction.nativeActionCardId; }
  /** @internal HoverStateMachine */
  canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean { return this.interaction.canEnter(hex, symbol, power); }
  /** @internal HoverStateMachine */
  canStepToEldorado(hex: Hex): boolean { return this.interaction.canStepToEldorado(hex); }
  /** @internal HoverStateMachine */
  canUseNativeOn(hex: Hex): boolean { return this.interaction.canUseNativeOn(hex); }
  /** @internal HoverStateMachine */
  selectedHandCardIds(): string[] { return this.interaction.selectedHandCardIds(); }
  /** @internal HoverStateMachine */
  movementRequirement(hex: Hex) { return this.interaction.movementRequirement(hex); }
  /** @internal HoverStateMachine */
  tryActOnHex(c: Axial): boolean { return this.interaction.tryActOnHex(c); }
  /** @internal HoverStateMachine */
  tryActOnBlockade(id: string): boolean { return this.interaction.tryActOnBlockade(id); }
  /** @internal HoverStateMachine */
  blockadeDestination(blockade: Blockade, symbol?: MoveSymbol, power?: number): Hex | undefined {
    return this.interaction.blockadeDestination(blockade, symbol, power);
  }
  /** @internal HoverStateMachine */
  blockadeRequiresDiscard(blockade: Blockade): boolean { return blockadeRequiresDiscard(blockade); }
  /** @internal HoverStateMachine */
  blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null { return blockadeMoveSymbol(blockade); }
  /** @internal HoverStateMachine */
  blockadeEdges(blockade: Blockade): Array<{ a: Axial; b: Axial }> {
    return this.interaction.blockadeEdges(blockade);
  }
  /** @internal HoverStateMachine */
  cardDefId(cardId: string, state: GameState): string { return cardDefId(cardId, state); }
  /** @internal HoverStateMachine */
  pickHandMover(req: MoveSymbol | null, cost: number, candidates: Array<{ id: string; defId: string }>) {
    return pickHandMover(req, cost, candidates);
  }

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
  private preview = el('div', 'card-preview inspector-popover panel hidden');
  private terrainPanel = el('div', 'terrain-panel inspector-popover panel hidden');
  /** @internal BoardCoordinator reads these for animateBuy / refreshPinnedPreview. */
  readonly handEls = new Map<string, HTMLElement>();
  // `readonly` (not `private`) so SessionController can read the market
  // slot DOM during onStateUpdate to capture source rects for buy animation.
  readonly shopEls = new Map<string, HTMLElement>();
  readonly playerCardEls = new Map<string, HTMLElement>();
  // playerHandPanel + pinnedPlayerId live in PlayerHandPanel (C1 extraction).
  /** @internal BoardCoordinator reads drawPileEl/discardPileEl for animateBuy. */
  drawPileEl: HTMLElement | null = null;
  /** @internal BoardCoordinator reads drawPileEl/discardPileEl for animateBuy. */
  discardPileEl: HTMLElement | null = null;
  /** @internal ActionLogPanel needs the isMobileDevice gate. */
  readonly mobileLayout: MobileLayoutProbe = new MobileLayoutProbe();
  /** @internal ActionLogPanel needs the showLogTerrainPreview entry point. */
  readonly hoverMachine: HoverStateMachine = undefined!;
  // `readonly` (not `private`) so SessionController's host interface
  // can call `resetActionLog()` during clearRoomState.
  readonly actionLogPanel!: ActionLogPanel;

  constructor(BoardClass: BoardConstructor) {
    this.mobileLayout.setupMobileLayoutClasses();
    document.body.appendChild(this.preview);
    document.body.appendChild(this.terrainPanel);
    this.board = new BoardClass(document.getElementById('board') as HTMLCanvasElement);
    (window as unknown as { __board: BoardInstance }).__board = this.board;
    (window as unknown as { __app: App }).__app = this;
    this.board.setViewMode(this.viewMode);
    this.hoverMachine = new HoverStateMachine(this.terrainPanel, this);
    this.actionLogPanel = new ActionLogPanel(this);
    this.interaction = new InteractionController(this);
    this.boardCtl = new BoardCoordinator(this);
    this.playerHandCtl = new PlayerHandPanel(this);
    this.overlays = new OverlaysController(this);
    this.settingsCtl = new SettingsMenuController(this);
    this.sessionCtl = new SessionController(this);
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

  private marketNeedsPromotion(state: GameState): boolean {
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
  /** @internal BoardCoordinator */
  setDrawPileEl(el: HTMLElement | null): void { this.drawPileEl = el; }
  /** @internal BoardCoordinator */
  setDiscardPileEl(el: HTMLElement | null): void { this.discardPileEl = el; }
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

  private makePile(kind: 'draw' | 'discard', label: string, count: number): HTMLElement {
    return this.boardCtl.makePile(kind, label, count);
  }

  // flyCard / animateBuy live in BoardCoordinator (B4). C6 — SessionController
  // calls boardCtl.animateBuy directly through the host interface, so the
  // App forwarders are no longer needed.

  // attachSheetDismiss lives in OverlaysController (C2 extraction).

  // --- card preview (hover on desktop; pinned on selection for touch) ---

  /** A card is "pinned" while it's selected — its preview stays open. */
  private isPinned(): boolean {
    return this.interaction.isPinned();
  }

  /** @internal ActionLogPanel → preview card chip on hover/click. */
  attachPreview(node: HTMLElement, defId: string): void {
    node.addEventListener('mouseenter', () => {
      if (this.interaction.usesMarketPreviewFlow()) return;
      this.showPreview(node, defId);
    });
    node.addEventListener('mouseleave', () => {
      if (this.interaction.usesMarketPreviewFlow()) return;
      if (this.isPinned()) this.refreshPinnedPreview();
      else this.hidePreview();
    });
  }

  /** Show the preview for the currently-selected card, anchored to its element. */
  /** @internal App → HoverStateMachine */
  refreshPinnedPreview(): void {
    const ix = this.interaction;
    if (ix.selected.size === 1 && this.state) {
      const id = [...ix.selected][0];
      const node = this.handEls.get(id);
      if (node) return this.showPreview(node, cardDefId(id, this.state));
    }
    if (ix.buyTargetDefId) {
      const node = this.shopEls.get(ix.buyTargetDefId);
      if (node) return this.showPreview(node, ix.buyTargetDefId);
    }
    if (ix.promoteTargetDefId) {
      const node = this.shopEls.get(ix.promoteTargetDefId);
      if (node) return this.showPreview(node, ix.promoteTargetDefId);
    }
    if (ix.marketPreviewDefId) {
      const node = this.shopEls.get(ix.marketPreviewDefId);
      if (node) return this.showPreview(node, ix.marketPreviewDefId);
    }
    this.hidePreview();
  }

  /** @internal ActionLogPanel → mobile tap-to-preview. */
  showPreview(anchor: HTMLElement, defId: string): void {
    const compactLandscape = this.mobileLayout.isCompactLandscape();
    const marketPreview = this.interaction.usesMarketPreviewFlow();

    this.preview.innerHTML = previewHtml(defId);
    this.preview.classList.toggle('from-log', this.mobilePanel === 'log');
    const actionableMarketPreview = marketPreview && this.interaction.marketPreviewDefId === defId && this.interaction.canSelectMarketPreview(defId);
    this.preview.classList.toggle('actionable', actionableMarketPreview);
    if (actionableMarketPreview) {
      const pile = this.state?.market.find((m) => m.defId === defId);
      const promote = !!pile && !pile.onBoard && this.marketNeedsPromotion(this.state!) && !this.state!.turn?.hasBought;
      const def = getDef(defId);
      const label = promote ? `放入市场 · ${def.cost}💰` : `选为购买目标 · ${def.cost}💰`;
      const select = button(label, () => this.interaction.selectMarketPreviewCard(), false);
      select.className = 'preview-select-card';
      this.preview.appendChild(select);
    }
    const pr = this.preview.getBoundingClientRect();
    if (marketPreview) {
      const marketRect = document.querySelector<HTMLElement>('.market-panel.open')?.getBoundingClientRect();
      const actionRect = document.querySelector<HTMLElement>('.action-bar')?.getBoundingClientRect();
      const marketIsDrawer = !!marketRect && marketRect.width < window.innerWidth * 0.7;
      if (compactLandscape && marketIsDrawer) {
        const leftLimit = (actionRect?.right ?? 0) + 8;
        const rightLimit = marketRect.left - 8;
        const available = Math.max(0, rightLimit - leftLimit);
        const x = available >= pr.width ? rightLimit - pr.width : Math.max(8, rightLimit - pr.width);
        const y = 48;
        this.preview.style.left = `${Math.max(8, Math.min(x, window.innerWidth - pr.width - 8))}px`;
        this.preview.style.top = `${Math.max(8, Math.min(y, window.innerHeight - pr.height - 8))}px`;
      } else {
        const x = window.innerWidth / 2 - pr.width / 2;
        const y = 12;
        this.preview.style.left = `${Math.max(8, Math.min(x, window.innerWidth - pr.width - 8))}px`;
        this.preview.style.top = `${Math.max(8, Math.min(y, window.innerHeight - pr.height - 8))}px`;
      }
      this.preview.classList.remove('hidden');
      return;
    }
    if (compactLandscape) {
      const x = window.innerWidth - pr.width - 8;
      const y = 48;
      this.preview.style.left = `${Math.max(8, x)}px`;
      this.preview.style.top = `${Math.max(8, Math.min(y, window.innerHeight - pr.height - 8))}px`;
      this.preview.classList.remove('hidden');
      return;
    }

    // Dock every card preview (hand, market and action log) to the same left
    // inspector position used by terrain hover details.
    let x = 14;
    let y = 76;
    x = Math.max(10, Math.min(x, window.innerWidth - pr.width - 10));
    y = Math.max(10, Math.min(y, window.innerHeight - pr.height - 10));
    this.preview.style.left = `${x}px`;
    this.preview.style.top = `${y}px`;
    this.preview.classList.remove('hidden');
  }

  /** @internal App → HoverStateMachine */
  hidePreview(): void {
    this.preview.classList.add('hidden');
    this.preview.classList.remove('actionable');
    this.preview.classList.remove('from-log');
  }

  // --- player hand inspector lives in PlayerHandPanel (C1 extraction) ---

  // Lobby rendering moved to packages/client/src/lobby/LobbyView.ts; App no
  // longer owns the lobby element. App only renders the in-game HUD.
  // --- rendering: HUD ---

  // progressOf is a pure helper that lives in @eldorado/core (C5 extraction).

  // buildActionLogPanel moved to ActionLogPanel.buildPanel — see
  // controllers/ActionLogPanel.ts. App's renderActionLog and
  // renderMobileActionLogDialog below now just call it.

  private renderActionLog(): void {
    this.hud.appendChild(this.actionLogPanel.buildPanel());
  }

  private renderMobileActionLogDialog(): void {
    const scrim = el('div', 'mobile-log-scrim');
    scrim.onclick = () => this.closeMobilePanel();

    const dialog = this.actionLogPanel.buildPanel('mobile-log-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.addEventListener('click', (ev) => ev.stopPropagation());
    const close = button('×', () => this.closeMobilePanel(), true);
    close.className = 'mobile-log-close';
    close.setAttribute('aria-label', '关闭行动日志');
    dialog.appendChild(close);
    scrim.appendChild(dialog);
    this.hud.appendChild(scrim);
  }

  // showLogTerrainPreview moved to HoverStateMachine — call sites use
  // `this.hoverMachine.showLogTerrainPreview(...)`.

  renderHud(): void {
    this.hidePreview();
    const previousMarketScrollTop = this.mobilePanel === 'market'
      ? this.hud.querySelector<HTMLElement>('.market-panel.open')?.scrollTop ?? null
      : null;
    if (!this.state || this.state.phase === 'lobby') {
      this.hud.innerHTML = '';
      return;
    }
    const s = this.state;
    const myTurn = this.isMyTurn();
    const turnPlayer = s.players.find((p) => p.id === s.turn?.playerId);
    const turnName = turnPlayer ? playerDisplayName(turnPlayer) : '';
    this.hud.innerHTML = '';
    this.handEls.clear();
    this.shopEls.clear();

    this.hud.appendChild(buildGearDock({
      onToggle: () => this.settingsCtl.toggleSettings(),
      isOpen: this.settingsCtl.isOpen(),
    }));

    // --- top bar ---
    this.hud.appendChild(buildTopBar({
      state: s,
      myTurn,
      roomCode: this.room?.code ?? null,
      viewMode: this.viewMode,
    }));

    if (this.settingsCtl.isOpen()) this.settingsCtl.renderSettingsMenu(s);

    // --- mobile toolbar (log + market sheet toggles) ---
    this.hud.appendChild(buildMobileToolbar({
      getOpen: () => this.mobilePanel,
      toggle: (which) => {
        this.mobilePanel = this.mobilePanel === which ? null : which;
      },
      clearMarketPreview: () => { this.interaction.marketPreviewDefId = null; },
      renderHud: () => this.renderHud(),
    }));

    // --- top-centre: players as cards ---
    this.playerCardEls.clear();
    this.hud.appendChild(
      renderPlayerBar(
        {
          players: s.players,
          turnOrder: s.turnOrder,
          turnPlayerId: s.turn?.playerId ?? null,
          selfId: this.you,
          pinnedPlayerId: this.playerHandCtl.getPinnedPlayerId(),
          progressOf: (p) => progressOf(p, s),
        },
        {
          onCardClick: (id) => this.playerHandCtl.toggle(id),
          onCardRendered: (cardEl, id) => this.playerCardEls.set(id, cardEl),
        },
      ),
    );

    // --- right: market (all 18 cards; on-board buyable, others upcoming) ---
    const onBoard = s.market.filter((m) => m.onBoard && m.count > 0);
    const upcoming = s.market.filter((m) => !m.onBoard && m.count > 0);
    const needsPromotion = onBoard.length < 6 && upcoming.length > 0;
    const canPromote = myTurn && needsPromotion && !s.turn?.hasBought;
    const freeTakeAction = this.interaction.selectedActionCard()?.def.ability === 'take_free';
    const inlineMarketDetailDefId = this.interaction.usesMarketPreviewFlow()
      ? this.interaction.marketPreviewDefId ?? this.interaction.buyTargetDefId ?? this.interaction.promoteTargetDefId
      : null;
    const selectedCoinSum = [...this.interaction.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
    const market = renderMarketPanel(
      {
        market: s.market,
        myTurn,
        phase: s.phase,
        mobilePanelOpen: this.mobilePanel === 'market',
        buyTargetDefId: this.interaction.buyTargetDefId,
        promoteTargetDefId: this.interaction.promoteTargetDefId,
        marketPreviewDefId: this.interaction.marketPreviewDefId,
        usesMarketPreviewFlow: this.interaction.usesMarketPreviewFlow(),
        canPromote,
        needsPromotion,
        freeTakeAction,
        hasBought: !!s.turn?.hasBought,
        selectedCoinSum,
        inlineDetailDefId: inlineMarketDetailDefId,
        previousScrollTop: previousMarketScrollTop,
      },
      {
        onSlotRendered: (slotEl, defId) => this.shopEls.set(defId, slotEl),
        onMarketClick: (defId) => this.interaction.onMarketClick(defId),
        previewMarketCard: (defId) => this.interaction.previewMarketCard(defId),
        confirmPromoteMarket: () => this.interaction.confirmPromoteMarket(),
        confirmBuy: () => this.interaction.confirmBuy(),
        cancelDrawerBuy: () => {
          this.interaction.buyTargetDefId = null;
          this.interaction.promoteTargetDefId = null;
          this.interaction.marketPreviewDefId = null;
          this.interaction.hint = '';
          this.renderHud();
        },
        attachPreview: (node, defId) => this.attachPreview(node, defId),
        attachSheetDismiss: (panel) => this.overlays.attachSheetDismiss(panel),
        renderInlineDetail: (defId) => marketInlineDetailHtml(defId),
        canSelectMarketPreview: (defId) => this.interaction.canSelectMarketPreview(defId),
      },
    );
    this.hud.appendChild(market);

    // Mobile: a tap-to-dismiss scrim on the open sheet (swipe-down is wired
    // inside renderMarketPanel via attachSheetDismiss when the panel opens).
    if (this.mobilePanel === 'market') {
      const scrim = el('div', 'sheet-scrim');
      scrim.onclick = () => this.closeMobilePanel();
      this.hud.appendChild(scrim);
    }
    if (this.mobilePanel === 'log') {
      this.renderMobileActionLogDialog();
    }

    this.renderActionLog();

    // (draw/discard piles are built into the bottom dock, flanking the hand)

    // --- bottom dock: hand + actions ---
    const dock = el('div', 'dock');
    const me = this.me;
    const tray = renderHandPanel(
      {
        me,
        myTurn,
        phase: s.phase,
        selectedIds: this.interaction.selected,
        modeIsRemove: this.interaction.mode === 'remove',
        useLabelFor: (defId) => this.interaction.handActionUseLabel(getDef(defId)),
        defIdFor: (cardId) => cardDefId(cardId, s),
        attachPreview: (node, defId) => this.attachPreview(node, defId),
      },
      {
        onCardClick: (cardId) => this.interaction.onCardClick(cardId),
        onUseClick: (cardId, ev) => {
          ev.stopPropagation();
          this.interaction.useActionCardFromHand(cardId);
        },
      },
    );
    this.handEls.clear();
    if (me) {
      for (const c of me.hand) this.handEls.set(c.id, tray.querySelector<HTMLElement>(`.card.${getDef(c.defId).kind}`) ?? tray);
    }

    const turnActionCards = this.interaction.selectedActionCards();
    const turnActionCard = turnActionCards.length === 1 ? turnActionCards[0] : null;
    const turnActionPrompt: ActionCardPrompt | null = turnActionCard
      ? {
          count: 1,
          name: turnActionCard.def.name,
          ability: turnActionCard.def.ability,
          removeLimit: this.interaction.removeLimitForAbility(turnActionCard.def.ability),
          removeSelectedCount: this.interaction.selectedActionRemoveIds(turnActionCard.id).length,
        }
      : turnActionCards.length > 1
        ? { count: turnActionCards.length, name: '', ability: '', removeLimit: 0, removeSelectedCount: 0 }
        : null;
    const turnCost = this.interaction.buyTargetDefId ? getDef(this.interaction.buyTargetDefId).cost : null;
    const turnCoinHave = [...this.interaction.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
    const turnCompact = this.mobileLayout.isCompactCommandLayout();
    const turnHasActionCards = turnActionCards.length > 0 || !!this.interaction.nativeActionCardId;
    const turnUseLabel = this.interaction.nativeActionCardId
      ? (turnCompact ? '选目标' : '选择向导目标')
      : this.interaction.selectedActionUseLabel(turnCompact);
    const turnRemoveCount = this.selectedHandCardIds().length;
    const turnHandSize = me?.hand.length ?? 0;
    const turnTrimMin = Math.max(0, turnHandSize - HAND_SIZE);
    const turnTakeFree = this.interaction.selectedActionCard()?.def.ability === 'take_free';
    const turnMarketNeedsPromotion = this.marketNeedsPromotion(s);
    const turnClearCost = this.interaction.clearBlockadeId
      ? this.blockadeById(this.interaction.clearBlockadeId)?.cost ?? 0
      : this.interaction.clearTarget ? this.hexAt(this.interaction.clearTarget)?.cost ?? 0 : 0;
    const bar = renderTurnInfoPanel(
      {
        myTurn,
        phase: s.phase,
        turnName,
        me,
        state: s,
        mode: this.interaction.mode,
        removeAfterDrawLimit: this.interaction.removeAfterDrawLimit,
        pendingTrim: !!s.turn?.pendingTrim,
        handSizeLimit: HAND_SIZE,
        promoteTargetDefId: this.interaction.promoteTargetDefId,
        buyTargetDefId: this.interaction.buyTargetDefId,
        cost: turnCost,
        coinHave: turnCoinHave,
        hasActionCards: turnHasActionCards,
        nativeActionCardId: this.interaction.nativeActionCardId,
        takeFreeSelected: turnTakeFree,
        actionPrompt: turnActionPrompt,
        useLabel: turnUseLabel,
        useDisabled: !!this.interaction.nativeActionCardId,
        canUseAction: this.interaction.canUseSelectedAction(),
        removeCount: turnRemoveCount,
        trimSel: turnRemoveCount,
        trimMin: turnTrimMin,
        isCompact: turnCompact,
        marketNeedsPromotion: turnMarketNeedsPromotion,
        selectedCount: this.interaction.selected.size,
        clearCost: turnClearCost,
        clearIsBlockade: !!this.interaction.clearBlockadeId,
      },
      {
        onConfirmRemove: () => this.interaction.confirmRemoveAfterDraw(),
        onCancelMode: () => this.interaction.cancelMode(),
        onConfirmTrim: () => this.interaction.confirmTrim(),
        onConfirmPromote: () => this.interaction.confirmPromoteMarket(),
        onConfirmBuy: () => this.interaction.confirmBuy(),
        onUseAction: () => this.interaction.useSelectedAction(),
        onEndTurn: () => this.act({ type: 'EndTurn' }),
        onDiscard: () => {
          if (this.interaction.selected.size === 0) return;
          this.act({ type: 'DiscardCards', cardIds: [...this.interaction.selected] });
        },
      },
    );
    // Piles flank the hand on the same row; draw on the left, discard on the right.
    if (me) {
      const drawPile = this.makePile('draw', '摸牌', me.deck.length);
      const discardPile = this.makePile('discard', '弃牌', me.discard.length);
      this.setDrawPileEl(drawPile);
      this.setDiscardPileEl(discardPile);
      dock.appendChild(drawPile);
      dock.appendChild(tray);
      dock.appendChild(discardPile);
    } else {
      this.setDrawPileEl(null);
      this.setDiscardPileEl(null);
      dock.appendChild(tray);
    }
    this.hud.appendChild(dock);
    this.hud.appendChild(bar); // floats bottom-right

    // Keep the selected card's preview open (no hover needed — for touch).
    this.refreshPinnedPreview();

    if (this.error) {
      const t = el('div', 'toast');
      t.textContent = this.error;
      this.hud.appendChild(t);
    }
    if (s.phase === 'finished') this.overlays.renderGameOverOverlay(s);
    this.hoverMachine.renderTerrainPanel();
    // 出牌 / 摸牌后手牌变了，pinned 玩家手牌面板要反映最新数据；
    // renderHud 已经重建了玩家卡 DOM（pinned-hand class 重新挂上），这里刷新 panel 内容
    if (this.playerHandCtl.getPinnedPlayerId()) this.playerHandCtl.refresh();
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
