import './style.css';
import { WebSocketAdapter } from './net/WebSocketAdapter.js';
import type { ISocketPort, SocketEvent } from './net/SocketPort.js';
import { cardFace } from './cardFaces.js';
import { BootController } from './boot/BootController.js';
import { LobbyController } from './lobby/LobbyController.js';
import { GameStore } from './store/GameStore.js';
import { SYMBOL_GLYPH, SYMBOL_LABEL } from './views/common/iconMap.js';
import { button, cardBack, colorHex, el, escapeHtml, playerDisplayName } from './views/common/dom.js';
import { renderHandPanel } from './views/hand/HandPanel.js';
import { renderMarketPanel } from './views/market/MarketPanel.js';
import { renderPlayerBar } from './views/players/PlayerBar.js';
import { renderTurnInfoPanel, type ActionCardPrompt } from './views/turn/TurnInfoPanel.js';
import {
  clearTurnIntro as clearTurnIntroOverlay,
  showTurnIntro as showTurnIntroOverlay,
} from './views/overlays/TurnIntroOverlay.js';
import { renderGameOverOverlay as renderGameOverOverlayEl } from './views/overlays/GameOverOverlay.js';
import {
  getDef,
  CARD_DEFS,
  HAND_SIZE,
  movableSymbols,
  coinValue,
  neighbors,
  isAdjacent,
  distance,
  pickHandMover,
  MAP_OPTIONS,
  type GameState,
  type RoomView,
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

const MAP_OPTION_IDS = new Set(MAP_OPTIONS.map((m) => m.id));
const DEFAULT_MAP_ID = MAP_OPTION_IDS.has('official-first') ? 'official-first' : 'classic';
const START_COUNTDOWN_MS = 5000;

function safeMapId(id: string | null): string {
  return id && MAP_OPTION_IDS.has(id) ? id : DEFAULT_MAP_ID;
}

function terrainSymbol(t: Terrain): MoveSymbol | null {
  if (t === 'green') return 'machete';
  if (t === 'blue') return 'paddle';
  if (t === 'yellow') return 'coin';
  return null;
}

function blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null {
  return terrainSymbol(blockade.terrain) ?? blockade.symbol ?? null;
}

function blockadeRequiresDiscard(blockade: Blockade): boolean {
  return blockade.terrain === 'rubble' || blockadeMoveSymbol(blockade) === null;
}

function isFinishEntrance(hex: Hex | null | undefined): boolean {
  return !!hex && (hex.finishEntrance === true || hex.terrain === 'finish');
}

/** Symbol a hex demands to enter. */
function requiredFor(hex: Hex): MoveSymbol | null {
  if (hex.terrain === 'finish') return hex.reqSymbol ?? null;
  if (hex.reqSymbol) return hex.reqSymbol;
  return terrainSymbol(hex.terrain);
}

/** Power a single step onto this hex costs. */
function stepCost(hex: Hex): number {
  if (hex.terrain === 'start') return 1;
  if (hex.terrain === 'eldorado') return 0;
  if (hex.terrain === 'finish') return Math.max(hex.cost, 1);
  return hex.cost;
}

function sameCoord(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

class App {
  net: ISocketPort = new WebSocketAdapter(WebSocketAdapter.defaultUrl());
  board: BoardInstance;
  you: string | null = null;
  room: RoomView | null = null;
  state: GameState | null = null;

  // interaction state lives in InteractionController (B3 extraction)
  private interaction!: InteractionController;

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
  terrainInfo(hex: Hex): TerrainInfo { return terrainInfo(hex); }
  /** @internal HoverStateMachine */
  blockadeInfo(blockade: Blockade): TerrainInfo { return blockadeInfo(blockade); }
  /** @internal HoverStateMachine */
  blockadeTerrain(blockade: Blockade): Terrain { return blockadeTerrain(blockade); }
  /** @internal HoverStateMachine */
  terrainCostText(hex: Hex): string { return terrainCostText(hex); }
  /** @internal HoverStateMachine */
  blockadeCostText(blockade: Blockade): string { return blockadeCostText(blockade); }
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
  /** Host's preferred per-action AI delay in ms (default 1s), persisted locally. */
  aiDelay = Number(localStorage.getItem('eldorado.aiDelay')) || 1000;
  error = '';
  /** Which mobile overlay is open (null = none). */
  mobilePanel: 'players' | 'market' | 'log' | null = null;
  /** Whether the in-game settings dropdown is open. */
  private settingsOpen = false;
  private systemDialog: HTMLElement | null = null;

  private hud = document.getElementById('hud') as HTMLDivElement;
  private store = new GameStore();
  private lobbyCtl = new LobbyController({ socket: this.net, store: this.store });
  private preview = el('div', 'card-preview inspector-popover panel hidden');
  private terrainPanel = el('div', 'terrain-panel inspector-popover panel hidden');
  private handEls = new Map<string, HTMLElement>();
  private shopEls = new Map<string, HTMLElement>();
  private playerCardEls = new Map<string, HTMLElement>();
  // 玩家手牌检视面板：独立 panel，跟卡牌 preview / 地形 panel 完全解耦。
  // 生命周期不同——pinned 才存在，hover 不触发。
  private playerHandPanel = el('div', 'player-hand-panel panel hidden');
  private pinnedPlayerId: string | null = null;
  private drawPileEl: HTMLElement | null = null;
  private discardPileEl: HTMLElement | null = null;
  /** @internal ActionLogPanel needs the isMobileDevice gate. */
  readonly mobileLayout: MobileLayoutProbe = new MobileLayoutProbe();
  /** @internal ActionLogPanel needs the showLogTerrainPreview entry point. */
  readonly hoverMachine: HoverStateMachine = undefined!;
  private actionLogPanel!: ActionLogPanel;

  constructor(BoardClass: BoardConstructor) {
    this.mobileLayout.setupMobileLayoutClasses();
    document.body.appendChild(this.preview);
    document.body.appendChild(this.terrainPanel);
    document.body.appendChild(this.playerHandPanel);
    // 点 player-hand-panel 之外的位置时关闭。挂一次，listener 内部判断 pinned 状态。
    document.addEventListener('mousedown', (ev) => {
      if (!this.pinnedPlayerId) return;
      const t = ev.target as Node | null;
      if (!t) return;
      if (this.playerHandPanel.contains(t)) return;
      if (this.playerCardEls.get(this.pinnedPlayerId)?.contains(t)) return;
      this.closePlayerHandPanel();
    });
    this.board = new BoardClass(document.getElementById('board') as HTMLCanvasElement);
    (window as unknown as { __board: BoardInstance }).__board = this.board;
    (window as unknown as { __app: App }).__app = this;
    this.board.setViewMode(this.viewMode);
    this.hoverMachine = new HoverStateMachine(this.terrainPanel, this);
    this.actionLogPanel = new ActionLogPanel(this);
    this.interaction = new InteractionController(this);
    this.board.onHexHover = (c) => this.hoverMachine.onHexHover(c);
    this.board.onHexClick = (c) => this.hoverMachine.onHexClick(c);
    this.board.onBlockadeHover = (id) => this.hoverMachine.onBlockadeHover(id);
    this.board.onBlockadeClick = (id) => this.hoverMachine.onBlockadeClick(id);
    this.net.on((e) => this.onSocketEvent(e));
    this.lobbyCtl.mount(document.getElementById('lobby') as HTMLDivElement);
  }

  // --- networking ---

  private onSocketEvent(e: SocketEvent): void {
    if (e.kind === 'open') this.rejoinSavedSession();
    else if (e.kind === 'message') this.onMessage(e.payload);
    // 'close' / 'error' have no in-app handler (adapter drives reconnect).
  }

  private onMessage(m: ServerMessage): void {
    // Mirror every server message into the store so other components can
    // subscribe. The App's local UI state (this.room / this.state / etc.)
    // remains the source of truth for the existing code paths — the store
    // is a parallel observable for future refactors (Stage 5.x).
    this.store.dispatch(m);
    switch (m.type) {
      case 'joined':
        this.you = m.playerId;
        this.board.setSelfPlayerId(this.you);
        sessionStorage.setItem('eldorado.session', JSON.stringify({ code: m.code, playerId: m.playerId }));
        break;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'lobby') {
          this.clearTurnIntro();
          this.state = null;
          this.actionLogPanel.resetActionLog();
          this.resetSelection();
          this.board.setHighlights([]);
          this.board.setBlockadeHighlights([]);
          this.renderHud();
        }
        break;
      case 'state': {
        const previousState = this.state;
        const buys = (m.events ?? []).filter((e) => e.type === 'bought') as Array<{
          type: 'bought';
          playerId: string;
          defId: string;
        }>;
        // Capture market source rects BEFORE the DOM is rebuilt.
        const sources = new Map<string, DOMRect>();
        for (const e of buys) {
          const node = this.shopEls.get(e.defId);
          // start from the card-face thumbnail (card-shaped), not the whole row
          const thumb = node?.querySelector('.card-thumb') ?? node;
          if (thumb) sources.set(`${e.defId}|${e.playerId}`, thumb.getBoundingClientRect());
        }
        this.actionLogPanel.rememberCards(previousState);
        this.actionLogPanel.rememberCards(m.state);
        this.actionLogPanel.appendActionLog(m.events ?? [], m.state, previousState);
        const shouldShowTurnIntro = this.shouldShowTurnIntro(previousState, m.state, m.events ?? []);
        const turnPlayerChanged = !!previousState
          && previousState.turn?.playerId !== m.state.turn?.playerId;
        this.state = m.state;
        this.syncSelectionToState();
        this.enterGameView();
        if (turnPlayerChanged) this.board.panToPlayerIfOffscreen(m.state.turn?.playerId ?? null);
        if (shouldShowTurnIntro) this.showTurnIntro();
        for (const e of buys) this.animateBuy(e.playerId, e.defId, sources.get(`${e.defId}|${e.playerId}`));
        break;
      }
      case 'roomClosed':
        this.onRoomClosed(m.message);
        break;
      case 'error':
        this.error = m.message;
        this.renderHud();
        setTimeout(() => {
          if (this.error === m.message) {
            this.error = '';
            this.renderHud();
          }
        }, 2500);
        break;
    }
  }

  /** @internal InteractionController → server */
  act(action: Action): void {
    this.net.send({ type: 'action', action });
  }

  private rejoinSavedSession(): void {
    const saved = sessionStorage.getItem('eldorado.session');
    if (!saved) return;
    try {
      const { code, playerId } = JSON.parse(saved) as { code?: string; playerId?: string };
      if (code && playerId) this.net.send({ type: 'rejoin', code, playerId });
    } catch {
      sessionStorage.removeItem('eldorado.session');
    }
  }

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

  private resetSelection(): void {
    this.interaction.resetSelection();
  }

  private leaveRoom(): void {
    if (this.room || this.you) this.net.send({ type: 'leaveRoom' });
    this.clearRoomState();
    this.lobbyCtl.notifyLeftRoom();
    this.renderHud();
  }

  /** Expose the server-driven state slice for subscribers (other controllers, views). */
  getStore(): GameStore {
    return this.store;
  }

  private clearRoomState(): void {
    this.clearTurnIntro();
    sessionStorage.removeItem('eldorado.session');
    this.you = null;
    this.room = null;
    this.state = null;
    this.actionLogPanel.resetActionLog();
    this.resetSelection();
    this.mobilePanel = null;
    this.board.setSelfPlayerId(null);
    this.board.setHighlights([]);
    this.board.setBlockadeHighlights([]);
    this.board.setInspectedHex(null);
    this.board.setInspectedBlockade(null);
    this.hoverMachine.closeTerrainPanel();
  }

  private shouldShowTurnIntro(previousState: GameState | null, nextState: GameState, events: GameEvent[]): boolean {
    if (!this.you || nextState.phase !== 'playing' || nextState.turn?.playerId !== this.you) return false;
    if (previousState?.turn?.playerId === this.you) return false;
    if (previousState) return true;
    return events.some((e) => e.type === 'turnStarted' && e.playerId === this.you);
  }

  private showTurnIntro(): void {
    showTurnIntroOverlay();
  }

  private clearTurnIntro(): void {
    clearTurnIntroOverlay();
  }

  private returnToLobby(): void {
    this.net.send({ type: 'returnToLobby' });
  }

  private onRoomClosed(message: string): void {
    this.lobbyCtl.endStarting();
    this.clearRoomState();
    this.lobbyCtl.render();
    this.renderHud();
    this.showSystemDialog('房间已解散', message);
  }

  private showSystemDialog(title: string, message: string): void {
    this.systemDialog?.remove();
    const scrim = el('div', 'system-dialog-scrim');
    scrim.innerHTML = `
      <div class="system-dialog panel" role="dialog" aria-modal="true" aria-labelledby="system-dialog-title">
        <div class="system-dialog-mark" aria-hidden="true"></div>
        <h2 id="system-dialog-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="gold">确认</button>
      </div>`;
    scrim.querySelector<HTMLButtonElement>('button')!.onclick = () => {
      scrim.remove();
      if (this.systemDialog === scrim) this.systemDialog = null;
      this.lobbyCtl.render();
      this.renderHud();
    };
    document.body.appendChild(scrim);
    this.systemDialog = scrim;
  }

  // --- action log: see controllers/ActionLogPanel.ts ---

  // --- selection sync + movement legality live in InteractionController (B3) ---

  private recomputeHighlights(): void {
    this.interaction.recomputeHighlights();
  }

  // --- input ---
  // Board hover/click handlers and all interaction dispatch (tryActOnHex,
  // tryActOnBlockade, onCardClick, onMarketClick, …) live in
  // controllers/InteractionController.ts (B3 extraction). Thin forwarders
  // are kept above for HoverStateMachine and the renderer.

  // --- selection / input dispatch lives in InteractionController (B3) ---

  // Forwarders consumed by the renderer (renderHud) and external callers.
  // Keeping them as thin wrappers avoids rewriting every call site that
  // already says `this.onCardClick(...)` or `this.marketNeedsPromotion(s)`.
  private onCardClick(cardId: string): void { this.interaction.onCardClick(cardId); }
  private onMarketClick(defId: string): void { this.interaction.onMarketClick(defId); }
  private usesMarketPreviewFlow(): boolean { return this.interaction.usesMarketPreviewFlow(); }
  private previewMarketCard(defId: string): void { this.interaction.previewMarketCard(defId); }
  private selectMarketPreviewCard(): void { this.interaction.selectMarketPreviewCard(); }
  private canSelectMarketPreview(defId: string): boolean { return this.interaction.canSelectMarketPreview(defId); }
  private selectedActionCards() { return this.interaction.selectedActionCards(); }
  private selectedActionCard() { return this.interaction.selectedActionCard(); }
  private selectedActionRemoveIds(actionCardId: string): string[] {
    return this.interaction.selectedActionRemoveIds(actionCardId);
  }
  private removeLimitForAbility(ability: string | undefined): number {
    return this.interaction.removeLimitForAbility(ability);
  }
  private selectedActionUseLabel(compact = false): string {
    return this.interaction.selectedActionUseLabel(compact);
  }
  private handActionUseLabel(def: ReturnType<typeof getDef>): string {
    return this.interaction.handActionUseLabel(def);
  }
  private canUseSelectedAction(): boolean { return this.interaction.canUseSelectedAction(); }
  private useActionCardFromHand(cardId: string): void { this.interaction.useActionCardFromHand(cardId); }
  private useSelectedAction(): void { this.interaction.useSelectedAction(); }
  private promoteMarket(defId: string): void { this.interaction.promoteMarket(defId); }
  private confirmPromoteMarket(): void { this.interaction.confirmPromoteMarket(); }
  private confirmBuy(): void { this.interaction.confirmBuy(); }
  private confirmRemoveAfterDraw(): void { this.interaction.confirmRemoveAfterDraw(); }
  private confirmTrim(): void { this.interaction.confirmTrim(); }
  private cancelMode(): void { this.interaction.cancelMode(); }

  private closeMobilePanel(): void {
    this.mobilePanel = null;
    this.interaction.marketPreviewDefId = null;
    this.renderHud();
  }

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === '3d' ? '2d' : '3d';
    localStorage.setItem('eldorado.viewMode', this.viewMode);
    this.board.setViewMode(this.viewMode);
    this.renderHud();
  }

  private setViewMode(mode: '3d' | '2d'): void {
    if (mode === this.viewMode) return;
    this.toggleViewMode(); // only two modes; flips and re-renders (keeps menu open)
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    this.renderHud();
  }

  /** In-game settings modal: view mode + exit, blocking game interaction behind it. */
  private renderSettingsMenu(s: GameState): void {
    const scrim = el('div', 'settings-scrim');
    scrim.onclick = () => {
      this.settingsOpen = false;
      this.renderHud();
    };
    this.hud.appendChild(scrim);

    const menu = el('div', 'settings-menu panel');
    menu.innerHTML = `
      <button class="settings-close" aria-label="关闭设置">×</button>
      <div class="settings-head">探险设置</div>
      <div class="settings-group">
        <span class="settings-label">视图模式</span>
        <div class="seg" role="group" aria-label="视图模式">
          <button class="seg-btn ${this.viewMode === '3d' ? 'on' : ''}" data-v="3d">3D</button>
          <button class="seg-btn ${this.viewMode === '2d' ? 'on' : ''}" data-v="2d">2D</button>
        </div>
      </div>
      <div class="settings-group">
        <span class="settings-label">AI 行动间隔</span>
        <div class="settings-delay">
          <input type="range" class="delay-range" min="0" max="10" step="0.5"
                 value="${(((this.room?.aiDelayMs ?? 1000) / 1000)).toFixed(1)}"
                 style="--fill:${(((this.room?.aiDelayMs ?? 1000) / 1000) / 10 * 100).toFixed(1)}%"
                 ${this.room?.hostId === this.you ? '' : 'disabled'} />
          <span class="delay-value">${(((this.room?.aiDelayMs ?? 1000) / 1000)).toFixed(1)}<i>s</i></span>
        </div>
        ${this.room?.hostId === this.you ? '' : '<span class="settings-hint">仅房主可调整</span>'}
      </div>`;
    menu.querySelector<HTMLButtonElement>('.settings-close')!.onclick = () => {
      this.settingsOpen = false;
      this.renderHud();
    };
    menu.querySelectorAll<HTMLButtonElement>('.seg-btn').forEach((b) => {
      b.onclick = () => this.setViewMode(b.dataset.v as '3d' | '2d');
    });
    const range = menu.querySelector<HTMLInputElement>('.delay-range');
    const valueLabel = menu.querySelector<HTMLSpanElement>('.delay-value');
    if (range) {
      range.oninput = () => {
        const secs = Number(range.value);
        range.style.setProperty('--fill', `${(secs / 10) * 100}%`);
        if (valueLabel) valueLabel.innerHTML = `${secs.toFixed(1)}<i>s</i>`;
      };
      range.onchange = () => {
        if (this.room?.hostId !== this.you) return;
        const ms = Math.round(Number(range.value) * 1000);
        this.aiDelay = ms;
        localStorage.setItem('eldorado.aiDelay', String(ms));
        this.net.send({ type: 'setAiDelay', ms });
      };
    }
    if (s.phase === 'playing') {
      const exit = button('退出游戏', () => {
        this.settingsOpen = false;
        this.leaveRoom();
      });
      exit.className = 'danger settings-exit';
      exit.title = '退出本局，AI 将接管你的座位';
      menu.appendChild(exit);
    }
    this.hud.appendChild(menu);
  }

  private flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** @internal InteractionController */
  flash(msg: string): void {
    this.error = msg;
    this.renderHud();
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.error = '';
      this.renderHud();
    }, 1800);
  }

  // --- piles & buy animation ---

  private makePile(kind: 'draw' | 'discard', label: string, count: number): HTMLElement {
    const pile = el('div', `pile ${kind}`);
    const empty = count === 0;
    pile.innerHTML = `
      <div class="pile-stack ${empty ? 'empty' : ''}">
        <span class="pile-card"></span>
        <span class="pile-card"></span>
        <span class="pile-card top">${cardBack()}</span>
      </div>
      <div class="pile-label">${label} <b>${count}</b></div>`;
    return pile;
  }

  /** Fly a card-shaped clone of the bought card from the market to its destination. */
  private flyCard(defId: string, from: DOMRect, to: DOMRect, fade: boolean): void {
    const W = 70;
    const H = 98; // card aspect, independent of the source row's shape
    const fromCx = from.left + from.width / 2;
    const fromCy = from.top + from.height / 2;
    const fly = el('div', 'fly-card');
    fly.innerHTML = cardFace(getDef(defId));
    fly.style.left = `${fromCx - W / 2}px`;
    fly.style.top = `${fromCy - H / 2}px`;
    fly.style.width = `${W}px`;
    fly.style.height = `${H}px`;
    document.body.appendChild(fly);
    requestAnimationFrame(() => {
      const dx = to.left + to.width / 2 - fromCx;
      const dy = to.top + to.height / 2 - fromCy;
      fly.style.transform = `translate(${dx}px, ${dy}px) scale(${fade ? 0.5 : 0.75})`;
      if (fade) fly.style.opacity = '0';
    });
    setTimeout(() => fly.remove(), 850);
  }

  private animateBuy(playerId: string, defId: string, source?: DOMRect): void {
    const immediateHandEl = defId === 'cartographer'
      ? [...(this.me?.hand ?? [])].reverse().find((c) => c.defId === defId)
      : undefined;
    const toEl = playerId === this.you
      ? (immediateHandEl ? this.handEls.get(immediateHandEl.id) : this.discardPileEl)
      : this.playerCardEls.get(playerId);
    if (!toEl) return;
    let from = source;
    const offscreen =
      !from || from.width === 0 || from.bottom < 0 || from.top > window.innerHeight || from.left > window.innerWidth;
    if (offscreen) {
      // market not visible (e.g. closed sheet) → fall back to the right edge
      from = new DOMRect(window.innerWidth - 56, window.innerHeight / 2 - 30, 40, 56);
    }
    this.flyCard(defId, from!, toEl.getBoundingClientRect(), playerId !== this.you);
  }

  /** Let a bottom sheet be dragged down (when scrolled to top) to dismiss it. */
  private attachSheetDismiss(panel: HTMLElement): void {
    let startY = 0;
    let dragging = false;
    panel.addEventListener(
      'touchstart',
      (e) => {
        dragging = panel.scrollTop <= 0;
        startY = e.touches[0].clientY;
        if (dragging) panel.style.transition = 'none';
      },
      { passive: true },
    );
    panel.addEventListener(
      'touchmove',
      (e) => {
        if (!dragging) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 0) panel.style.transform = `translateY(${dy}px)`;
      },
      { passive: true },
    );
    panel.addEventListener('touchend', (e) => {
      if (!dragging) return;
      const dy = e.changedTouches[0].clientY - startY;
      panel.style.transition = '';
      panel.style.transform = '';
      dragging = false;
      if (dy > 70) this.closeMobilePanel();
    });
  }

  // --- card preview (hover on desktop; pinned on selection for touch) ---

  /** A card is "pinned" while it's selected — its preview stays open. */
  private isPinned(): boolean {
    return this.interaction.isPinned();
  }

  /** @internal ActionLogPanel → preview card chip on hover/click. */
  attachPreview(node: HTMLElement, defId: string): void {
    node.addEventListener('mouseenter', () => {
      if (this.usesMarketPreviewFlow()) return;
      this.showPreview(node, defId);
    });
    node.addEventListener('mouseleave', () => {
      if (this.usesMarketPreviewFlow()) return;
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
    const marketPreview = this.usesMarketPreviewFlow();

    this.preview.innerHTML = previewHtml(defId);
    this.preview.classList.toggle('from-log', this.mobilePanel === 'log');
    const actionableMarketPreview = marketPreview && this.interaction.marketPreviewDefId === defId && this.canSelectMarketPreview(defId);
    this.preview.classList.toggle('actionable', actionableMarketPreview);
    if (actionableMarketPreview) {
      const pile = this.state?.market.find((m) => m.defId === defId);
      const promote = !!pile && !pile.onBoard && this.marketNeedsPromotion(this.state!) && !this.state!.turn?.hasBought;
      const def = getDef(defId);
      const label = promote ? `放入市场 · ${def.cost}💰` : `选为购买目标 · ${def.cost}💰`;
      const select = button(label, () => this.selectMarketPreviewCard(), false);
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

  // --- player hand inspector (pinned, independent from card preview / terrain panel) ---

  private togglePlayerHand(playerId: string): void {
    if (this.pinnedPlayerId === playerId) {
      this.closePlayerHandPanel();
    } else {
      this.pinnedPlayerId = playerId;
      this.renderPlayerHandPanel();
      // 高亮当前 pinned 玩家卡
      this.playerCardEls.forEach((el, id) => el.classList.toggle('pinned-hand', id === playerId));
    }
  }

  private closePlayerHandPanel(): void {
    this.pinnedPlayerId = null;
    this.playerHandPanel.classList.add('hidden');
    this.playerHandPanel.innerHTML = '';
    this.playerCardEls.forEach((el) => el.classList.remove('pinned-hand'));
  }

  private renderPlayerHandPanel(): void {
    if (!this.state || !this.pinnedPlayerId) return;
    const player = this.state.players.find((p) => p.id === this.pinnedPlayerId);
    if (!player) {
      // 玩家已离开（断线/被踢）→ 自动关闭
      this.closePlayerHandPanel();
      return;
    }
    // 整局汇总：手牌 + 牌库 + 弃牌（removed 是永久离开游戏的牌，不计入）
    const counts = new Map<string, { defId: string; count: number; hand: number; deck: number; discard: number }>();
    const bump = (c: { defId: string }, bucket: 'hand' | 'deck' | 'discard') => {
      const cur = counts.get(c.defId) ?? { defId: c.defId, count: 0, hand: 0, deck: 0, discard: 0 };
      cur.count++;
      cur[bucket]++;
      counts.set(c.defId, cur);
    };
    for (const c of player.hand) bump(c, 'hand');
    for (const c of player.deck) bump(c, 'deck');
    for (const c of player.discard) bump(c, 'discard');
    // 按 kind 排（green/blue/yellow/action/joker），同 kind 按牌名
    const kindRank: Record<string, number> = { green: 0, blue: 1, yellow: 2, action: 3, joker: 4 };
    const entries = [...counts.values()]
      .map((e) => ({ def: getDef(e.defId), ...e }))
      .sort((a, b) =>
        (kindRank[a.def.kind] ?? 9) - (kindRank[b.def.kind] ?? 9)
        || a.def.name.localeCompare(b.def.name, 'zh'),
      );
    const totalAll = player.hand.length + player.deck.length + player.discard.length;
    const playerColor = colorHex(player.color);
    const breakdown = (e: { hand: number; deck: number; discard: number }) => {
      const parts: string[] = [];
      if (e.hand) parts.push(`手 ${e.hand}`);
      if (e.deck) parts.push(`库 ${e.deck}`);
      if (e.discard) parts.push(`弃 ${e.discard}`);
      return parts.join(' · ');
    };
    const rows = entries.length === 0
      ? '<div class="php-empty">该玩家目前没有任何牌</div>'
      : entries.map((e) => `
          <div class="php-row" style="--pc: ${playerColor}">
            <div class="php-thumb">${cardFace(e.def)}</div>
            <div class="php-info">
              <div class="php-name">${escapeHtml(e.def.name)}</div>
              <div class="php-kind">${KIND_LABEL[e.def.kind] ?? ''}${e.def.singleUse ? ' · 单次' : ''} · ${breakdown(e)}</div>
            </div>
            <div class="php-count" title="手牌 + 牌库 + 弃牌合计">×${e.count}</div>
          </div>`).join('');
    this.playerHandPanel.style.setProperty('--pc', playerColor);
    this.playerHandPanel.innerHTML = `
      <div class="php-head">
        <span class="php-dot"></span>
        <div class="php-title-wrap">
          <div class="php-kicker">整局持牌</div>
          <div class="php-title">${escapeHtml(playerDisplayName(player))}</div>
        </div>
        <button class="php-close" aria-label="关闭持牌详情" type="button">×</button>
      </div>
      <div class="php-list">${rows}</div>
      <div class="php-foot">合计 ${totalAll} 张（手 ${player.hand.length} · 库 ${player.deck.length} · 弃 ${player.discard.length}）</div>`;
    this.playerHandPanel.classList.remove('hidden');
    this.playerHandPanel
      .querySelector<HTMLButtonElement>('.php-close')!
      .addEventListener('click', () => this.closePlayerHandPanel());
  }

  private enterGameView(): void {
    if (!this.state || this.state.phase === 'lobby') return;
    this.board.setSelfPlayerId(this.you);
    this.board.render(this.state);
    this.renderHud();
    this.recomputeHighlights();
    this.hoverMachine.renderTerrainPanel();
  }

  // Lobby rendering moved to packages/client/src/lobby/LobbyView.ts; App no
  // longer owns the lobby element. App only renders the in-game HUD.
  // --- rendering: HUD ---

  /** Rough progress 0..1 toward El Dorado, for the player roster bars. */
  private progressOf(p: { position: Axial; finished: boolean }): number {
    const s = this.state;
    if (!s) return 0;
    if (p.finished) return 1;
    const finishes = s.hexes.some((h) => h.terrain === 'eldorado')
      ? s.hexes.filter((h) => h.terrain === 'eldorado')
      : s.hexes.filter((h) => isFinishEntrance(h));
    const starts = s.hexes.filter((h) => h.terrain === 'start');
    if (!finishes.length) return 0;
    const toFinish = (pos: Axial) => Math.min(...finishes.map((f) => distance(pos, f)));
    const ref = starts.length ? Math.max(...starts.map((st) => toFinish(st))) : 1;
    return Math.max(0, Math.min(1, 1 - toFinish(p.position) / Math.max(ref, 1)));
  }

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
    const winnerPlayer = s.winnerId ? s.players.find((p) => p.id === s.winnerId) : null;
    const turnName = turnPlayer ? playerDisplayName(turnPlayer) : '';
    const winnerName = winnerPlayer ? playerDisplayName(winnerPlayer) : null;
    this.hud.innerHTML = '';
    this.handEls.clear();
    this.shopEls.clear();

    const gearDock = el('div', 'settings-dock');
    const gear = button('⚙', () => this.toggleSettings(), true);
    gear.className = `settings-gear ${this.settingsOpen ? 'active' : ''}`;
    gear.title = '设置';
    gearDock.appendChild(gear);
    this.hud.appendChild(gearDock);

    // --- top bar ---
    const top = el('div', 'topbar panel');
    let banner = `<div class="turn-banner">⏳ 等待 ${escapeHtml(turnName)}</div>`;
    if (s.phase === 'finished') banner = `<div class="turn-banner win">🏆 ${escapeHtml(winnerName ?? '')} 抵达黄金城！</div>`;
    else if (myTurn) banner = `<div class="turn-banner you">🟢 轮到你行动</div>`;
    top.innerHTML = `
      <div class="brand"><span class="logo">🏆</span><span>冲向黄金城</span><span class="code">${escapeHtml(this.room?.code ?? '')}</span></div>
      ${banner}
      <div class="hint-inline">${this.viewMode === '2d' ? '2D 俯视 · 拖拽平移 · 滚轮缩放' : '滚轮缩放 · 拖拽平移 · 右键转视角'}</div>`;
    this.hud.appendChild(top);

    if (this.settingsOpen) this.renderSettingsMenu(s);

    // --- mobile toolbar (log + market sheet toggles) ---
    const toolbar = el('div', 'mobile-toolbar');
    const logBtn = button('日志', () => {
      this.mobilePanel = this.mobilePanel === 'log' ? null : 'log';
      this.interaction.marketPreviewDefId = null;
      this.renderHud();
    });
    if (this.mobilePanel === 'log') logBtn.classList.add('active');
    toolbar.appendChild(logBtn);
    const mbtn = button('市场', () => {
      this.mobilePanel = this.mobilePanel === 'market' ? null : 'market';
      if (this.mobilePanel !== 'market') this.interaction.marketPreviewDefId = null;
      this.renderHud();
    });
    if (this.mobilePanel === 'market') mbtn.classList.add('active');
    toolbar.appendChild(mbtn);
    this.hud.appendChild(toolbar);

    // --- top-centre: players as cards ---
    this.playerCardEls.clear();
    this.hud.appendChild(
      renderPlayerBar(
        {
          players: s.players,
          turnOrder: s.turnOrder,
          turnPlayerId: s.turn?.playerId ?? null,
          selfId: this.you,
          pinnedPlayerId: this.pinnedPlayerId,
          progressOf: (p) => this.progressOf(p),
        },
        {
          onCardClick: (id) => this.togglePlayerHand(id),
          onCardRendered: (cardEl, id) => this.playerCardEls.set(id, cardEl),
        },
      ),
    );

    // --- right: market (all 18 cards; on-board buyable, others upcoming) ---
    const onBoard = s.market.filter((m) => m.onBoard && m.count > 0);
    const upcoming = s.market.filter((m) => !m.onBoard && m.count > 0);
    const needsPromotion = onBoard.length < 6 && upcoming.length > 0;
    const canPromote = myTurn && needsPromotion && !s.turn?.hasBought;
    const freeTakeAction = this.selectedActionCard()?.def.ability === 'take_free';
    const inlineMarketDetailDefId = this.usesMarketPreviewFlow()
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
        usesMarketPreviewFlow: this.usesMarketPreviewFlow(),
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
        onMarketClick: (defId) => this.onMarketClick(defId),
        previewMarketCard: (defId) => this.previewMarketCard(defId),
        confirmPromoteMarket: () => this.confirmPromoteMarket(),
        confirmBuy: () => this.confirmBuy(),
        cancelDrawerBuy: () => {
          this.interaction.buyTargetDefId = null;
          this.interaction.promoteTargetDefId = null;
          this.interaction.marketPreviewDefId = null;
          this.interaction.hint = '';
          this.renderHud();
        },
        attachPreview: (node, defId) => this.attachPreview(node, defId),
        attachSheetDismiss: (panel) => this.attachSheetDismiss(panel),
        renderInlineDetail: (defId) => marketInlineDetailHtml(defId),
        canSelectMarketPreview: (defId) => this.canSelectMarketPreview(defId),
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
        useLabelFor: (defId) => this.handActionUseLabel(getDef(defId)),
        defIdFor: (cardId) => cardDefId(cardId, s),
        attachPreview: (node, defId) => this.attachPreview(node, defId),
      },
      {
        onCardClick: (cardId) => this.onCardClick(cardId),
        onUseClick: (cardId, ev) => {
          ev.stopPropagation();
          this.useActionCardFromHand(cardId);
        },
      },
    );
    this.handEls.clear();
    if (me) {
      for (const c of me.hand) this.handEls.set(c.id, tray.querySelector<HTMLElement>(`.card.${getDef(c.defId).kind}`) ?? tray);
    }

    const turnActionCards = this.selectedActionCards();
    const turnActionCard = turnActionCards.length === 1 ? turnActionCards[0] : null;
    const turnActionPrompt: ActionCardPrompt | null = turnActionCard
      ? {
          count: 1,
          name: turnActionCard.def.name,
          ability: turnActionCard.def.ability,
          removeLimit: this.removeLimitForAbility(turnActionCard.def.ability),
          removeSelectedCount: this.selectedActionRemoveIds(turnActionCard.id).length,
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
      : this.selectedActionUseLabel(turnCompact);
    const turnRemoveCount = this.selectedHandCardIds().length;
    const turnHandSize = me?.hand.length ?? 0;
    const turnTrimMin = Math.max(0, turnHandSize - HAND_SIZE);
    const turnTakeFree = this.selectedActionCard()?.def.ability === 'take_free';
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
        canUseAction: this.canUseSelectedAction(),
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
        onConfirmRemove: () => this.confirmRemoveAfterDraw(),
        onCancelMode: () => this.cancelMode(),
        onConfirmTrim: () => this.confirmTrim(),
        onConfirmPromote: () => this.confirmPromoteMarket(),
        onConfirmBuy: () => this.confirmBuy(),
        onUseAction: () => this.useSelectedAction(),
        onEndTurn: () => this.act({ type: 'EndTurn' }),
        onDiscard: () => {
          if (this.interaction.selected.size === 0) return;
          this.act({ type: 'DiscardCards', cardIds: [...this.interaction.selected] });
        },
      },
    );
    // Piles flank the hand on the same row; draw on the left, discard on the right.
    if (me) {
      this.drawPileEl = this.makePile('draw', '摸牌', me.deck.length);
      this.discardPileEl = this.makePile('discard', '弃牌', me.discard.length);
      dock.appendChild(this.drawPileEl);
      dock.appendChild(tray);
      dock.appendChild(this.discardPileEl);
    } else {
      this.drawPileEl = this.discardPileEl = null;
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
    if (s.phase === 'finished') this.renderGameOverOverlay(s);
    this.hoverMachine.renderTerrainPanel();
    // 出牌 / 摸牌后手牌变了，pinned 玩家手牌面板要反映最新数据；
    // renderHud 已经重建了玩家卡 DOM（pinned-hand class 重新挂上），这里刷新 panel 内容
    if (this.pinnedPlayerId) this.renderPlayerHandPanel();
  }

  private renderGameOverOverlay(s: GameState): void {
    const overlay = renderGameOverOverlayEl(
      { players: s.players, winnerId: s.winnerId },
      {
        onReturnToLobby: () => this.returnToLobby(),
        onLeaveRoom: () => this.leaveRoom(),
      },
    );
    this.hud.appendChild(overlay);
  }

  // --- terrain / blockade hover & panel: see controllers/HoverStateMachine.ts
}

// --- small DOM helpers ---

function cardDefId(cardId: string, state: GameState): string {
  return findCardDefId(cardId, state) ?? fallbackCardDefId(cardId);
}

function findCardDefId(cardId: string, state: GameState): string | null {
  for (const p of state.players) {
    const c = [...p.hand, ...p.deck, ...p.discard, ...p.removed].find((x) => x.id === cardId);
    if (c) return c.defId;
  }
  const turnCard = [...(state.turn?.inPlay ?? []), ...(state.turn?.removedThisTurn ?? [])].find((x) => x.id === cardId);
  if (turnCard) return turnCard.defId;
  return null;
}

function fallbackCardDefId(cardId: string): string {
  // ids look like "playerId:defId#n"
  const m = cardId.match(/:([^:#]+)#/);
  return m ? m[1] : cardId;
}

const KIND_LABEL: Record<string, string> = {
  green: '丛林 · 砍刀',
  blue: '水域 · 船桨',
  yellow: '村庄 · 金币',
  joker: '万能牌',
  action: '行动牌',
};

type TerrainInfo = { name: string; icon: string; description: string; rule: string };

const TERRAIN_INFO: Record<Terrain, TerrainInfo> = {
  green: {
    name: '丛林',
    icon: '🗡️',
    description: '潮湿密集的雨林区域，队伍需要砍开藤蔓和灌木才能前进。',
    rule: '进入此格需要砍刀移动力，消耗等于格子上的数字。',
  },
  blue: {
    name: '河流',
    icon: '🛶',
    description: '河道与浅滩交错的水域，必须依靠船桨和水路经验通过。',
    rule: '进入此格需要船桨移动力，消耗等于格子上的数字。',
  },
  yellow: {
    name: '村庄',
    icon: '🪙',
    description: '村落、道路和交易点组成的陆路区域，金币可以换来向导和补给。',
    rule: '进入此格需要金币移动力，消耗等于格子上的数字。',
  },
  rubble: {
    name: '碎石障碍',
    icon: '⛏',
    description: '坍塌的石堆挡住去路，需要丢弃补给和工具来清出通道。',
    rule: '点击相邻碎石格后，选择指定数量的手牌弃掉，然后棋子进入该格。',
  },
  basecamp: {
    name: '营地障碍',
    icon: '⛺',
    description: '临时营地占住路线，穿过这里会消耗并淘汰一部分随身装备。',
    rule: '点击相邻营地格后，选择指定数量的手牌永久移出游戏，然后棋子进入该格。',
  },
  mountain: {
    name: '山地',
    icon: '⛰',
    description: '陡峭岩脊和高地阻隔路线，是地图上的天然屏障。',
    rule: '普通移动不能进入山地；原住民向导可以无视地形移动到相邻山地。',
  },
  start: {
    name: '起点营地',
    icon: '🚩',
    description: '探险队出发的位置，也是路线回环时可以经过的普通格。',
    rule: '进入起点格消耗 1 点任意移动力。',
  },
  finish: {
    name: '黄金城入口',
    icon: '🏆',
    description: '通向黄金城的最后入口。先进入入口，再从入口踏上黄金城主体，才算抵达终点。',
    rule: '进入入口需要满足格子的移动符号和消耗。',
  },
  eldorado: {
    name: '黄金城',
    icon: '🏛',
    description: '传说中的黄金城主体区域。探险队必须从任一黄金城入口踏上这里才算完成旅程。',
    rule: '只能从相邻的黄金城入口进入；最终踏入黄金城不需要出牌。进入后触发最终结算阶段。',
  },
};

function terrainInfo(hex: Hex): TerrainInfo {
  if (hex.finishEntrance && hex.terrain !== 'finish') {
    const base = TERRAIN_INFO[hex.terrain];
    return {
      ...base,
      name: `${base.name}入口`,
      description: `${base.description} 这里也是黄金城前的入口格。`,
      rule: `${terrainCostText(hex)}。先进入此入口，再从入口踏上黄金城主体，才算抵达终点。`,
    };
  }
  if (hex.terrain !== 'finish') return TERRAIN_INFO[hex.terrain];
  const symbol = hex.reqSymbol ? `${SYMBOL_GLYPH[hex.reqSymbol]}${SYMBOL_LABEL[hex.reqSymbol]}` : '任意移动力';
  return {
    ...TERRAIN_INFO.finish,
    rule: `进入入口需要 ${symbol}，消耗 ${Math.max(hex.cost, 1)} 点。入口本身不是终点，还需要再进入黄金城。`,
  };
}

function blockadeTerrain(blockade: Blockade): Terrain {
  if (blockade.terrain) return blockade.terrain;
  if (blockade.symbol === 'machete') return 'green';
  if (blockade.symbol === 'paddle') return 'blue';
  if (blockade.symbol === 'coin') return 'yellow';
  return 'yellow';
}

function blockadeInfo(blockade: Blockade): TerrainInfo {
  const terrain = blockadeTerrain(blockade);
  const base = TERRAIN_INFO[terrain];
  return {
    name: `${base.name}连接地形`,
    icon: base.icon,
    description: `连接两个大陆板块边缘的 Z 字形地形，地貌为${base.name}。它不是装饰物，而是可以被选择并穿越的路线。`,
    rule: `从这块地形覆盖的任一边跨到另一侧时，需要 ${blockadeCostText(blockade)}。第一位通过的玩家会领取这块连接地形，后续结算会记录在玩家信息中。`,
  };
}

function terrainCostText(hex: Hex): string {
  if (hex.terrain === 'mountain') return '普通移动不可进入';
  if (hex.terrain === 'eldorado') return '无需出牌';
  if (hex.terrain === 'rubble') return `清除费用 ${hex.cost} 张手牌`;
  if (hex.terrain === 'basecamp') return `移除费用 ${hex.cost} 张手牌`;
  if (hex.terrain === 'start') return '进入消耗 1 点任意移动力';
  if (hex.terrain === 'finish') {
    const symbol = hex.reqSymbol ? `${SYMBOL_GLYPH[hex.reqSymbol]} ${SYMBOL_LABEL[hex.reqSymbol]}` : '任意移动力';
    return `${symbol} ${Math.max(hex.cost, 1)} 点`;
  }
  const symbol = terrainSymbol(hex.terrain);
  return symbol ? `${SYMBOL_GLYPH[symbol]} ${SYMBOL_LABEL[symbol]} ${hex.cost} 点` : `消耗 ${hex.cost}`;
}

function blockadeCostText(blockade: Blockade): string {
  const symbol = blockadeMoveSymbol(blockade);
  if (!symbol) return `⛏ 弃 ${blockade.cost} 张手牌`;
  return `${SYMBOL_GLYPH[symbol]} ${SYMBOL_LABEL[symbol]} ${blockade.cost} 点`;
}

function cardDescription(defId: string): string {
  const def = getDef(defId);
  if (def.kind === 'joker') {
    return `万能牌：出牌时可当作 🗡️砍刀 / 🛶船桨 / 🪙金币 中任意一种使用（每次选一种，不可混用）。购买时按 ${def.power} 金币计。`;
  }
  if (def.kind === 'action') {
    switch (def.ability) {
      case 'draw2':
        return '抽 2 张牌，本回合可立即打出使用。';
      case 'draw1_remove1':
        return '抽 1 张牌，然后可将手牌中 1 张永久移出游戏（精简牌库）。';
      case 'draw3':
        return '抽 3 张牌。';
      case 'draw2_remove2':
        return '抽 2 张牌，并可移除至多 2 张手牌。';
      case 'take_free':
        return '免费获得市场上任意一张牌，置入弃牌堆。';
      case 'native':
        return '将棋子移动到相邻 1 格，无视该格地形需求（包括山地；未移除的连接地形仍会阻挡）。';
      default:
        return '行动牌。';
    }
  }
  const sym = def.symbol === 'machete' ? '丛林（绿）' : def.symbol === 'paddle' ? '水域（蓝）' : '村庄（黄）';
  let s = `移动牌：提供 ${def.power} 点力量，进入需求 ≤ ${def.power} 的${sym}地格，余力可逐格穿越。`;
  s += def.symbol === 'coin' ? ` 购买时按 ${def.power} 金币计。` : ' 购买时按 ½ 金币计。';
  return s;
}

function previewHtml(defId: string): string {
  const def = getDef(defId);
  const cost = def.starting
    ? '<span class="cp-cost">起始牌 · 不可购买</span>'
    : `<span class="cp-cost">购买消耗 <b>${def.cost}</b> 💰</span>`;
  const power = def.power ? `<span class="cp-pow">力量 ${def.power}</span>` : '';
  return `
    <div class="cp-art">${cardFace(def)}</div>
    <div class="cp-title">${escapeHtml(def.name)}</div>
    <div class="cp-type">${KIND_LABEL[def.kind] ?? ''}${def.singleUse ? ' · 单次性' : ''}</div>
    <div class="cp-desc">${cardDescription(defId)}</div>
    <div class="cp-foot">${cost}${power}</div>`;
}

function marketInlineDetailHtml(defId: string): string {
  const def = getDef(defId);
  const tags = [
    KIND_LABEL[def.kind] ?? '',
    def.singleUse ? '单次' : '',
    def.power ? `力量 ${def.power}` : '',
    def.starting ? '不可购买' : `${def.cost} 金币`,
  ].filter(Boolean).join(' · ');
  return `
    <div class="market-detail-head">
      <b>${escapeHtml(def.name)}</b>
      <span>${escapeHtml(tags)}</span>
    </div>
    <div class="market-detail-desc">${escapeHtml(cardDescription(defId))}</div>`;
}

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
