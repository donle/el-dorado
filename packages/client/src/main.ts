import './style.css';
import { Net } from './net.js';
import { Board } from './board.js';
import { cardFace } from './cardFaces.js';
import {
  getDef,
  CARD_DEFS,
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

const BOOT_ASSET_URLS = [
  '/ui/loading-table.jpg',
  '/ui/lobby-hero.jpg',
  '/ui/lobby-props.jpg',
  '/textures/golden-city-ground.jpg',
  '/cards/card-back.jpg',
  '/card-icons/machete.jpg',
  '/card-icons/paddle.jpg',
  '/card-icons/coin.jpg',
  '/card-icons/discard.jpg',
  '/card-icons/remove.jpg',
  '/card-icons/single_use.jpg',
  '/card-icons/native-move.png',
  ...Object.keys(CARD_DEFS).map((id) => `/cards/${id}.jpg`),
];

const SYMBOL_GLYPH: Record<string, string> = {
  machete: '🗡️',
  paddle: '🛶',
  coin: '🪙',
  discard: '⛏',
};
const SYMBOL_LABEL: Record<MoveSymbol, string> = {
  machete: '砍刀',
  paddle: '船桨',
  coin: '金币',
};
const KIND_GLYPH: Record<string, string> = {
  green: '🗡️',
  blue: '🛶',
  yellow: '🪙',
  joker: '🃏',
  action: '✨',
};
const MAP_OPTION_IDS = new Set(MAP_OPTIONS.map((m) => m.id));
const DEFAULT_MAP_ID = MAP_OPTION_IDS.has('official-first') ? 'official-first' : 'classic';

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

type Mode = 'idle' | 'clear' | 'remove';
type ActionLogSegment = { text: string; defId?: string; coord?: Axial; blockadeId?: string };
type ActionLogEntry = {
  id: number;
  playerId: string | null;
  playerName: string;
  playerColor: string;
  segments: ActionLogSegment[];
};

class App {
  net = new Net();
  board: Board;
  you: string | null = null;
  room: RoomView | null = null;
  state: GameState | null = null;

  // interaction
  selected = new Set<string>();
  mode: Mode = 'idle';
  buyTargetDefId: string | null = null;
  promoteTargetDefId: string | null = null;
  marketPreviewDefId: string | null = null;
  nativeActionCardId: string | null = null;
  clearTarget: Axial | null = null;
  clearBlockadeId: string | null = null;
  removeAfterDrawLimit = 0;
  viewMode: '3d' | '2d' = localStorage.getItem('eldorado.viewMode') === '2d' ? '2d' : '3d';
  selectedMapId = safeMapId(localStorage.getItem('eldorado.mapId'));
  /** Host's preferred per-action AI delay in ms (default 1s), persisted locally. */
  aiDelay = Number(localStorage.getItem('eldorado.aiDelay')) || 1000;
  hint = '';
  error = '';
  /** Which panel is open as a bottom sheet on mobile (null = none). */
  mobilePanel: 'players' | 'market' | null = null;
  nameValue = localStorage.getItem('eldorado.name') ?? '';
  /** True from "start game" until the first board state arrives (freezes lobby). */
  private starting = false;
  private startingTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the in-game settings dropdown is open. */
  private settingsOpen = false;

  private hud = document.getElementById('hud') as HTMLDivElement;
  private lobby = document.getElementById('lobby') as HTMLDivElement;
  private preview = el('div', 'card-preview inspector-popover panel hidden');
  private terrainPanel = el('div', 'terrain-panel inspector-popover panel hidden');
  private handEls = new Map<string, HTMLElement>();
  private shopEls = new Map<string, HTMLElement>();
  private playerCardEls = new Map<string, HTMLElement>();
  private drawPileEl: HTMLElement | null = null;
  private discardPileEl: HTMLElement | null = null;
  private mobileDeviceQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
  private portraitQuery = window.matchMedia('(orientation: portrait)');
  private hoveredTerrain: Axial | null = null;
  private pinnedTerrain: Axial | null = null;
  private hoveredBlockadeId: string | null = null;
  private pinnedBlockadeId: string | null = null;
  private terrainPanelHovering = false;
  private terrainHoverClearTimer: ReturnType<typeof setTimeout> | undefined;
  private actionLog: ActionLogEntry[] = [];
  private actionLogSeq = 0;
  private knownCardDefs = new Map<string, string>();

  constructor() {
    this.setupMobileLayoutClasses();
    document.body.appendChild(this.preview);
    document.body.appendChild(this.terrainPanel);
    this.board = new Board(document.getElementById('board') as HTMLCanvasElement);
    (window as unknown as { __board: Board }).__board = this.board;
    (window as unknown as { __app: App }).__app = this;
    this.board.setViewMode(this.viewMode);
    this.board.onHexHover = (c) => this.onHexHover(c);
    this.board.onHexClick = (c) => this.onHexClick(c);
    this.board.onBlockadeHover = (id) => this.onBlockadeHover(id);
    this.board.onBlockadeClick = (id) => this.onBlockadeClick(id);
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.connect();
    this.renderLobby();

    const saved = sessionStorage.getItem('eldorado.session');
    if (saved) {
      const { code, playerId } = JSON.parse(saved);
      this.net.send({ type: 'rejoin', code, playerId });
    }
  }

  private setupMobileLayoutClasses(): void {
    const update = () => {
      const mobile = this.isMobileDevice();
      document.body.classList.toggle('mobile-device', mobile);
      document.body.classList.toggle('mobile-portrait', mobile && this.portraitQuery.matches);
    };
    this.mobileDeviceQuery.addEventListener('change', update);
    this.portraitQuery.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    update();
  }

  private isMobileDevice(): boolean {
    const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    return uaMobile || (navigator.maxTouchPoints > 1 && this.mobileDeviceQuery.matches);
  }

  private isCompactLandscape(): boolean {
    return document.body.classList.contains('mobile-device')
      && !this.portraitQuery.matches
      && window.innerHeight <= 500;
  }

  private isCompactCommandLayout(): boolean {
    return document.body.classList.contains('mobile-device')
      && (this.portraitQuery.matches || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches);
  }

  // --- networking ---

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'joined':
        this.you = m.playerId;
        this.board.setSelfPlayerId(this.you);
        sessionStorage.setItem('eldorado.session', JSON.stringify({ code: m.code, playerId: m.playerId }));
        break;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'lobby') {
          this.endStarting();
          this.state = null;
          this.resetActionLog();
          this.resetSelection();
          this.board.setHighlights([]);
          this.board.setBlockadeHighlights([]);
          this.renderLobby();
          this.renderHud();
        } else if (m.room.phase === 'playing' && !this.state) {
          // Game is launching but board state hasn't arrived on this client yet
          // (we're behind the host, or just reconnected) — freeze the lobby.
          this.beginStarting();
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
        this.rememberCards(previousState);
        this.rememberCards(m.state);
        this.appendActionLog(m.events ?? [], m.state, previousState);
        this.state = m.state;
        this.syncSelectionToState();
        this.lobby.classList.add('hidden');
        this.endStarting();
        this.board.setSelfPlayerId(this.you);
        this.board.render(m.state);
        this.renderHud();
        this.recomputeHighlights();
        this.renderTerrainPanel();
        for (const e of buys) this.animateBuy(e.playerId, e.defId, sources.get(`${e.defId}|${e.playerId}`));
        break;
      }
      case 'error':
        this.endStarting(); // a failed startGame must release the frozen lobby
        this.error = m.message;
        this.renderLobby();
        this.renderHud();
        setTimeout(() => {
          this.error = '';
          this.renderLobby();
          this.renderHud();
        }, 2500);
        break;
    }
  }

  private act(action: Action): void {
    this.net.send({ type: 'action', action });
  }

  // --- helpers ---

  private get me() {
    return this.state?.players.find((p) => p.id === this.you) ?? null;
  }
  private isMyTurn(): boolean {
    return !!this.state && this.state.phase === 'playing' && this.state.turn?.playerId === this.you;
  }

  private marketNeedsPromotion(state: GameState): boolean {
    const active = state.market.filter((m) => m.onBoard && m.count > 0).length;
    return active < 6 && state.market.some((m) => !m.onBoard && m.count > 0);
  }
  private hexAt(c: Axial): Hex | undefined {
    return this.state?.hexes.find((h) => h.q === c.q && h.r === c.r);
  }

  private blockadeById(id: string | null): Blockade | undefined {
    return id ? this.state?.blockades.find((b) => b.id === id) : undefined;
  }

  private resetSelection(): void {
    this.selected.clear();
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.nativeActionCardId = null;
    this.clearTarget = null;
    this.clearBlockadeId = null;
    this.removeAfterDrawLimit = 0;
    this.hint = '';
  }

  private leaveRoom(): void {
    if (this.room || this.you) this.net.send({ type: 'leaveRoom' });
    sessionStorage.removeItem('eldorado.session');
    this.you = null;
    this.room = null;
    this.state = null;
    this.resetActionLog();
    this.resetSelection();
    this.mobilePanel = null;
    this.board.setSelfPlayerId(null);
    this.board.setHighlights([]);
    this.board.setBlockadeHighlights([]);
    this.board.setInspectedHex(null);
    this.board.setInspectedBlockade(null);
    this.closeTerrainPanel();
    this.renderLobby();
    this.renderHud();
  }

  private returnToLobby(): void {
    this.net.send({ type: 'returnToLobby' });
  }

  private resetActionLog(): void {
    this.actionLog = [];
    this.actionLogSeq = 0;
    this.knownCardDefs.clear();
  }

  private rememberCards(state: GameState | null): void {
    if (!state) return;
    for (const p of state.players) {
      for (const card of [...p.deck, ...p.hand, ...p.discard, ...p.removed]) {
        this.knownCardDefs.set(card.id, card.defId);
      }
    }
    for (const card of [...(state.turn?.inPlay ?? []), ...(state.turn?.removedThisTurn ?? [])]) {
      this.knownCardDefs.set(card.id, card.defId);
    }
  }

  private cardDefIdForLog(cardId: string, state: GameState, previousState: GameState | null): string {
    return findCardDefId(cardId, state)
      ?? (previousState ? findCardDefId(cardId, previousState) : null)
      ?? this.knownCardDefs.get(cardId)
      ?? fallbackCardDefId(cardId);
  }

  private cardSegmentByDefId(defId: string): ActionLogSegment {
    if (!CARD_DEFS[defId]) return { text: defId };
    return { text: getDef(defId).name, defId };
  }

  private cardSegmentByCardId(cardId: string, state: GameState, previousState: GameState | null): ActionLogSegment {
    return this.cardSegmentByDefId(this.cardDefIdForLog(cardId, state, previousState));
  }

  private playerLogInfo(
    playerId: string | null,
    state: GameState,
    previousState: GameState | null,
  ): { name: string; color: string } {
    const p = playerId
      ? state.players.find((x) => x.id === playerId) ?? previousState?.players.find((x) => x.id === playerId)
      : null;
    return p
      ? { name: playerDisplayName(p), color: colorHex(p.color) }
      : { name: '系统', color: '#ffd166' };
  }

  private activeMoverForPlayer(
    playerId: string,
    state: GameState,
    previousState: GameState | null,
  ): { cardId: string; symbol: MoveSymbol; remaining: number } | null {
    const states = [state, previousState].filter((x): x is GameState => !!x);
    for (const s of states) {
      const mover = s.turn?.playerId === playerId ? s.turn.activeMover : undefined;
      if (mover) return mover;
    }
    return null;
  }

  private activeMoverForCard(
    cardId: string,
    state: GameState,
    previousState: GameState | null,
  ): { cardId: string; symbol: MoveSymbol; remaining: number } | null {
    const states = [state, previousState].filter((x): x is GameState => !!x);
    for (const s of states) {
      const mover = s.turn?.activeMover;
      if (mover?.cardId === cardId) return mover;
    }
    return null;
  }

  private terrainLogSegment(to: Axial, state: GameState): ActionLogSegment {
    const hex = state.hexes.find((h) => sameCoord(h, to));
    return {
      text: hex ? `${terrainInfo(hex).name} (${to.q}, ${to.r})` : `(${to.q}, ${to.r})`,
      coord: { q: to.q, r: to.r },
    };
  }

  private blockadeLogSegment(blockadeId: string): ActionLogSegment {
    return { text: '连接地形', blockadeId };
  }

  private inferTakenMarketDefId(state: GameState, previousState: GameState | null): string | null {
    if (!previousState) return null;
    for (const pile of state.market) {
      const before = previousState.market.find((m) => m.defId === pile.defId);
      if (before && before.count > pile.count) return pile.defId;
    }
    return null;
  }

  private appendActionLog(events: GameEvent[], state: GameState, previousState: GameState | null): void {
    if (events.length === 0) return;
    const entry = this.describeActionEvents(events, state, previousState);
    if (!entry) return;
    this.actionLog.push(entry);
    this.actionLog = this.actionLog.slice(-60);
  }

  private makeActionLogEntry(
    playerId: string | null,
    segments: ActionLogSegment[],
    state: GameState,
    previousState: GameState | null,
  ): ActionLogEntry {
    const player = this.playerLogInfo(playerId, state, previousState);
    return {
      id: ++this.actionLogSeq,
      playerId,
      playerName: player.name,
      playerColor: player.color,
      segments,
    };
  }

  private describeActionEvents(
    events: GameEvent[],
    state: GameState,
    previousState: GameState | null,
  ): ActionLogEntry | null {
    const cardPlayed = events.find((e) => e.type === 'cardPlayed') as Extract<GameEvent, { type: 'cardPlayed' }> | undefined;
    const moved = events.find((e) => e.type === 'movedTo') as Extract<GameEvent, { type: 'movedTo' }> | undefined;
    const spaceCleared = events.find((e) => e.type === 'spaceCleared') as Extract<GameEvent, { type: 'spaceCleared' }> | undefined;
    const marketPromoted = events.find((e) => e.type === 'marketPromoted') as Extract<GameEvent, { type: 'marketPromoted' }> | undefined;
    const bought = events.find((e) => e.type === 'bought') as Extract<GameEvent, { type: 'bought' }> | undefined;
    const discarded = events.find((e) => e.type === 'discarded') as Extract<GameEvent, { type: 'discarded' }> | undefined;
    const removedCards = events.find((e) => e.type === 'removedCards') as Extract<GameEvent, { type: 'removedCards' }> | undefined;
    const ability = events.find((e) => e.type === 'ability') as Extract<GameEvent, { type: 'ability' }> | undefined;
    const drew = events.find((e) => e.type === 'drew') as Extract<GameEvent, { type: 'drew' }> | undefined;
    const blockadeClaimed = events.find((e) => e.type === 'blockadeClaimed') as Extract<GameEvent, { type: 'blockadeClaimed' }> | undefined;
    const reachedEldorado = events.find((e) => e.type === 'reachedEldorado') as Extract<GameEvent, { type: 'reachedEldorado' }> | undefined;
    const turnStarted = events.find((e) => e.type === 'turnStarted') as Extract<GameEvent, { type: 'turnStarted' }> | undefined;
    const gameOver = events.find((e) => e.type === 'gameOver') as Extract<GameEvent, { type: 'gameOver' }> | undefined;

    if (gameOver) {
      const winner = gameOver.winnerId ? this.playerLogInfo(gameOver.winnerId, state, previousState).name : null;
      return this.makeActionLogEntry(gameOver.winnerId, [{ text: winner ? '赢得游戏' : '游戏结束' }], state, previousState);
    }

    if (bought) {
      return this.makeActionLogEntry(
        bought.playerId,
        [{ text: '购买 ' }, this.cardSegmentByDefId(bought.defId)],
        state,
        previousState,
      );
    }

    if (marketPromoted) {
      return this.makeActionLogEntry(
        marketPromoted.playerId,
        [{ text: '将 ' }, this.cardSegmentByDefId(marketPromoted.defId), { text: ' 补入市场' }],
        state,
        previousState,
      );
    }

    if (ability) {
      const segments: ActionLogSegment[] = [
        { text: '使用 ' },
        this.cardSegmentByCardId(ability.cardId, state, previousState),
      ];
      if (moved) segments.push({ text: '，移动到 ' }, this.terrainLogSegment(moved.to, state));
      if (drew) segments.push({ text: `，摸 ${drew.count} 张牌` });
      if (removedCards) segments.push({ text: removedCards.count > 0 ? `，移除 ${removedCards.count} 张手牌` : '，不移除手牌' });
      const takenDefId = this.inferTakenMarketDefId(state, previousState);
      if (takenDefId) segments.push({ text: '，获得 ' }, this.cardSegmentByDefId(takenDefId));
      if (reachedEldorado) segments.push({ text: '，抵达黄金城' });
      return this.makeActionLogEntry(ability.playerId, segments, state, previousState);
    }

    if (spaceCleared) {
      return this.makeActionLogEntry(
        spaceCleared.playerId,
        [
          { text: `${spaceCleared.removed ? '移除手牌清除营地' : '弃掉手牌清除碎石'}，移动到 ` },
          this.terrainLogSegment(spaceCleared.to, state),
        ],
        state,
        previousState,
      );
    }

    if (cardPlayed && blockadeClaimed) {
      return this.makeActionLogEntry(
        cardPlayed.playerId,
        [
          { text: '打出 ' },
          this.cardSegmentByCardId(cardPlayed.cardId, state, previousState),
          { text: '，移除' },
          this.blockadeLogSegment(blockadeClaimed.blockadeId),
        ],
        state,
        previousState,
      );
    }

    if (cardPlayed) {
      const mover = this.activeMoverForCard(cardPlayed.cardId, state, previousState);
      const symbol = mover ? `（${SYMBOL_LABEL[mover.symbol]}）` : '';
      return this.makeActionLogEntry(
        cardPlayed.playerId,
        [{ text: '打出 ' }, this.cardSegmentByCardId(cardPlayed.cardId, state, previousState), { text: symbol }],
        state,
        previousState,
      );
    }

    if (blockadeClaimed) {
      return this.makeActionLogEntry(
        blockadeClaimed.playerId,
        [{ text: '移除' }, this.blockadeLogSegment(blockadeClaimed.blockadeId)],
        state,
        previousState,
      );
    }

    if (moved) {
      const mover = this.activeMoverForPlayer(moved.playerId, state, previousState);
      const segments: ActionLogSegment[] = mover
        ? [
          { text: '使用 ' },
          this.cardSegmentByCardId(mover.cardId, state, previousState),
          { text: '，移动到 ' },
          this.terrainLogSegment(moved.to, state),
        ]
        : [{ text: '移动到 ' }, this.terrainLogSegment(moved.to, state)];
      if (reachedEldorado) segments.push({ text: '，抵达黄金城' });
      return this.makeActionLogEntry(moved.playerId, segments, state, previousState);
    }

    if (discarded) {
      return this.makeActionLogEntry(
        discarded.playerId,
        [{ text: `弃掉 ${discarded.count} 张手牌` }],
        state,
        previousState,
      );
    }

    if (removedCards) {
      return this.makeActionLogEntry(
        removedCards.playerId,
        [{ text: removedCards.count > 0 ? `移除 ${removedCards.count} 张手牌` : '不移除手牌' }],
        state,
        previousState,
      );
    }

    if (drew || turnStarted) {
      const actorId = drew?.playerId ?? previousState?.turn?.playerId ?? turnStarted?.playerId ?? null;
      const segments: ActionLogSegment[] = [];
      if (turnStarted && actorId !== turnStarted.playerId) {
        segments.push({ text: '结束回合' });
        if (drew) segments.push({ text: `，摸 ${drew.count} 张牌` });
        segments.push({ text: `；轮到 ${this.playerLogInfo(turnStarted.playerId, state, previousState).name}` });
      } else if (drew) {
        segments.push({ text: `摸 ${drew.count} 张牌` });
      } else if (turnStarted) {
        segments.push({ text: '开始回合' });
      }
      return this.makeActionLogEntry(actorId, segments, state, previousState);
    }

    return null;
  }

  /**
   * Reconcile selection when fresh server state arrives. Transient targets
   * (buy/clear/mode) always reset, but the hand selection is PRESERVED across
   * the player's own turn so a multi-card movement chain keeps walking without
   * re-selecting — each step's played card simply drops out of the hand and is
   * pruned here. Selection is cleared entirely when it isn't our turn.
   */
  private syncSelectionToState(): void {
    const wasRemoveMode = this.mode === 'remove';
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.nativeActionCardId = null;
    this.clearTarget = null;
    this.clearBlockadeId = null;
    this.removeAfterDrawLimit = 0;
    this.hint = '';
    if (!this.isMyTurn() || !this.me) {
      this.selected.clear();
      return;
    }
    const handIds = new Set(this.me.hand.map((c) => c.id));
    for (const id of [...this.selected]) if (!handIds.has(id)) this.selected.delete(id);
    const pending = this.state?.turn?.pendingRemoval;
    if (pending) {
      if (!wasRemoveMode) this.selected.clear();
      this.mode = 'remove';
      this.removeAfterDrawLimit = pending.max;
      this.hint = `选择最多 ${pending.max} 张手牌移除，或直接跳过`;
    }
  }

  private blockadeBetween(from: Axial, to: Axial): Blockade | undefined {
    return this.state?.blockades.find((blockade) => {
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      return edges.some(
        (edge) =>
          (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
      );
    });
  }

  private blockadeEdges(blockade: Blockade): Array<{ a: Axial; b: Axial }> {
    return blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  }

  private blockadeDestination(blockade: Blockade, symbol?: MoveSymbol, power?: number): Hex | undefined {
    const me = this.me;
    if (!me) return undefined;
    for (const edge of this.blockadeEdges(blockade)) {
      const to = sameCoord(edge.a, me.position) ? edge.b : sameCoord(edge.b, me.position) ? edge.a : null;
      if (!to) continue;
      const hex = this.hexAt(to);
      if (!hex) continue;
      if (symbol && power !== undefined && !this.canEnter(hex, symbol, power)) continue;
      return hex;
    }
    return undefined;
  }

  private canClearBlockade(blockade: Blockade): boolean {
    return !blockade.claimedBy && blockadeRequiresDiscard(blockade) && !!this.blockadeDestination(blockade);
  }

  private selectedHandCardIds(): string[] {
    const handIds = new Set((this.me?.hand ?? []).map((c) => c.id));
    return [...this.selected].filter((id) => handIds.has(id));
  }

  private canClearSpaceWithSelection(hex: Hex): boolean {
    const me = this.me;
    if (!me) return false;
    if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp') return false;
    if (!isAdjacent(me.position, hex)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    if (blockade && !blockade.claimedBy) return false;
    return this.selectedHandCardIds().length === hex.cost;
  }

  private canRemoveBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade)
      && !!this.blockadeDestination(blockade)
      && blockadeMoveSymbol(blockade) === symbol && power >= blockade.cost;
  }

  private movementRequirement(
    hex: Hex,
  ): { required: MoveSymbol | null; cost: number; blockade?: Blockade; discard?: boolean; destReq?: MoveSymbol | null } {
    const me = this.me;
    const blockade = me ? this.blockadeBetween(me.position, hex) : undefined;
    if (blockade && !blockade.claimedBy) {
      const seamSym = blockadeMoveSymbol(blockade);
      if (seamSym === null) {
        // Discard seam: paid via ClearSpace; destination terrain not charged.
        return { required: null, cost: blockade.cost, blockade, discard: true };
      }
      // Symbol seam: pay the seam AND enter the destination terrain with one
      // mover, so the cost is combined and the single symbol must satisfy both.
      return { required: seamSym, cost: blockade.cost + stepCost(hex), blockade, destReq: requiredFor(hex) };
    }
    return { required: requiredFor(hex), cost: stepCost(hex) };
  }

  /** Can a mover (symbol/power) enter this hex right now? */
  private canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean {
    const me = this.me;
    if (!me || !isAdjacent(me.position, hex)) return false;
    if (hex.terrain === 'mountain') return false;
    const current = this.hexAt(me.position);
    if (hex.terrain === 'eldorado' && !isFinishEntrance(current)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') return false;
    const requirement = this.movementRequirement(hex);
    if (requirement.discard) return false;
    if (requirement.required !== null && requirement.required !== symbol) return false;
    // Crossing a symbol seam also has to enter the destination terrain, which a
    // single-symbol mover can only do when that terrain accepts the same symbol.
    if (requirement.destReq != null && requirement.destReq !== symbol) return false;
    return power >= requirement.cost;
  }

  private canStepToEldorado(hex: Hex): boolean {
    const me = this.me;
    if (!me || hex.terrain !== 'eldorado') return false;
    if (!isAdjacent(me.position, hex)) return false;
    const current = this.hexAt(me.position);
    if (!isFinishEntrance(current)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    return !blockade || !!blockade.claimedBy;
  }

  private canUseNativeOn(hex: Hex): boolean {
    const me = this.me;
    if (!me) return false;
    if (!isAdjacent(me.position, hex)) return false;
    if (hex.terrain === 'eldorado' && !isFinishEntrance(this.hexAt(me.position))) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    return !blockade || !!blockade.claimedBy;
  }

  private recomputeHighlights(): void {
    if (!this.isMyTurn() || !this.me) {
      this.board.setHighlights([]);
      this.board.setBlockadeHighlights([]);
      return;
    }
    const me = this.me;
    const adj = neighbors(me.position)
      .map((c) => this.hexAt(c))
      .filter((h): h is Hex => !!h);
    const out: Axial[] = [];
    const blockadeOut = new Set<string>();
    const mover = this.state!.turn?.activeMover;
    const unclaimedBlockades = this.state!.blockades.filter((b) => !b.claimedBy);

    if (this.mode === 'clear' || this.mode === 'remove') {
      // selection happens in the hand panel; no hex highlight
    } else if (this.nativeActionCardId) {
      for (const h of adj) if (this.canUseNativeOn(h)) out.push(h);
    } else if (mover && mover.remaining > 0) {
      for (const h of adj) if (this.canEnter(h, mover.symbol, mover.remaining)) out.push(h);
      for (const blockade of unclaimedBlockades) {
        if (this.canRemoveBlockade(blockade, mover.symbol, mover.remaining)) blockadeOut.add(blockade.id);
        if (this.canClearBlockade(blockade)) blockadeOut.add(blockade.id);
      }
    } else if (this.selected.size > 0) {
      for (const id of this.selected) {
        const def = getDef(cardDefId(id, this.state!));
        const syms = movableSymbols(def.defId);
        for (const h of adj) {
          if (syms.some((s) => this.canEnter(h, s, def.power))) out.push(h);
        }
        for (const blockade of unclaimedBlockades) {
          if (syms.some((s) => this.canRemoveBlockade(blockade, s, def.power))) blockadeOut.add(blockade.id);
        }
      }
      for (const blockade of unclaimedBlockades) {
        if (this.canClearBlockade(blockade)) blockadeOut.add(blockade.id);
      }
    } else {
      for (const blockade of unclaimedBlockades) {
        if (this.canClearBlockade(blockade)) blockadeOut.add(blockade.id);
      }
    }
    if (this.mode !== 'clear' && this.mode !== 'remove') {
      for (const h of adj) {
        if (this.canClearSpaceWithSelection(h)) out.push(h);
        if (this.canStepToEldorado(h)) out.push(h);
      }
    }
    this.board.setHighlights(out);
    this.board.setBlockadeHighlights([...blockadeOut]);
  }

  // --- input ---

  private onHexHover(c: Axial | null): void {
    this.cancelTerrainHoverClear();
    if (!c && this.hoveredTerrain && !this.pinnedTerrain && !this.pinnedBlockadeId) {
      this.scheduleTerrainHoverClear();
      return;
    }
    this.hoveredTerrain = c;
    if (c) this.hoveredBlockadeId = null;
    this.renderTerrainPanel();
    if (!c && !this.pinnedTerrain && !this.pinnedBlockadeId) this.refreshPinnedPreview();
  }

  private onHexClick(c: Axial): void {
    if (this.tryActOnHex(c)) return;

    if (this.pinnedTerrain && sameCoord(this.pinnedTerrain, c) && !this.pinnedBlockadeId) {
      this.pinnedTerrain = null;
      this.hoveredTerrain = null;
      this.board.setInspectedHex(null);
      this.board.clearHover();
      this.renderTerrainPanel();
      this.refreshPinnedPreview();
      return;
    }

    this.pinnedTerrain = c;
    this.pinnedBlockadeId = null;
    this.board.setInspectedHex(c);
    this.board.setInspectedBlockade(null);
    this.renderTerrainPanel();
  }

  private tryActOnHex(c: Axial): boolean {
    if (!this.isMyTurn()) return false;
    if (this.mode === 'clear' || this.mode === 'remove') return false;
    const hex = this.hexAt(c);
    const me = this.me;
    if (!hex || !me || !isAdjacent(me.position, hex)) return false;

    const between = this.blockadeBetween(me.position, hex);
    if (between && !between.claimedBy) {
      this.flash('先点连接地形移除障碍');
      return true;
    }

    if (this.nativeActionCardId) {
      if (!this.canUseNativeOn(hex)) {
        this.flash('原住民向导只能移动到可进入的相邻地形');
        return true;
      }
      const cardId = this.nativeActionCardId;
      this.nativeActionCardId = null;
      this.selected.delete(cardId);
      this.act({ type: 'UseAbility', cardId, nativeTo: c });
      return true;
    }

    if (this.canStepToEldorado(hex)) {
      this.act({ type: 'StepTo', to: c });
      return true;
    }

    // 1) Clearable terrain is paid like movement: select cards first, then target.
    if ((hex.terrain === 'rubble' || hex.terrain === 'basecamp') && !hex.occupant) {
      const cardIds = this.selectedHandCardIds();
      if (cardIds.length === 0) return false;
      if (cardIds.length !== hex.cost) {
        this.flash(`需要正好选择 ${hex.cost} 张手牌`);
        return true;
      }
      this.act({ type: 'ClearSpace', to: c, cardIds });
      return true;
    }

    const mover = this.state!.turn?.activeMover;
    // 2) Continue with the active mover (zero waste).
    if (mover && this.canEnter(hex, mover.symbol, mover.remaining)) {
      this.act({ type: 'StepTo', to: c });
      return true;
    }
    // 3) Pick least-waste card from selected that can pay this step.
    const { required, cost } = this.movementRequirement(hex);
    const hand = this.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((id) => hand.some((h) => h.id === id))
      .map((id) => ({ id, defId: cardDefId(id, this.state!) }));
    const pick = pickHandMover(required, cost, candidates);
    if (pick) {
      const pickDefId = candidates.find((c) => c.id === pick.cardId)!.defId;
      if (this.canEnter(hex, pick.symbol, getDef(pickDefId).power)) {
        this.selected.delete(pick.cardId);
        this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
        this.act({ type: 'StepTo', to: c });
        return true;
      }
    }
    return false;
  }

  private onBlockadeHover(id: string | null): void {
    this.cancelTerrainHoverClear();
    if (!id && this.hoveredBlockadeId && !this.pinnedTerrain && !this.pinnedBlockadeId) {
      this.scheduleTerrainHoverClear();
      return;
    }
    this.hoveredBlockadeId = id;
    if (id) this.hoveredTerrain = null;
    this.renderTerrainPanel();
    if (!id && !this.pinnedTerrain && !this.pinnedBlockadeId) this.refreshPinnedPreview();
  }

  private onBlockadeClick(id: string): void {
    if (this.tryActOnBlockade(id)) return;

    if (this.pinnedBlockadeId === id && !this.pinnedTerrain) {
      this.pinnedBlockadeId = null;
      this.hoveredBlockadeId = null;
      this.board.setInspectedBlockade(null);
      this.board.clearHover();
      this.renderTerrainPanel();
      this.refreshPinnedPreview();
      return;
    }

    this.pinnedBlockadeId = id;
    this.pinnedTerrain = null;
    this.board.setInspectedBlockade(id);
    this.board.setInspectedHex(null);
    this.renderTerrainPanel();
  }

  private tryActOnBlockade(id: string): boolean {
    if (!this.isMyTurn()) return false;
    if (this.mode === 'clear' || this.mode === 'remove') return false;
    const blockade = this.blockadeById(id);
    if (!blockade) return false;

    // Unclaimed: REMOVE in place (do not move).
    if (!blockade.claimedBy) {
      if (!this.blockadeDestination(blockade)) return false;
      if (blockadeRequiresDiscard(blockade)) {
        // enter card-selection to discard exactly blockade.cost cards
        this.mode = 'clear';
        this.clearBlockadeId = blockade.id;
        this.clearTarget = null; // marker: removing a blockade, not a hex
        this.selected.clear();
        this.hint = `选 ${blockade.cost} 张牌弃掉，移除这块连接地形`;
        this.renderHud();
        this.recomputeHighlights();
        this.renderTerrainPanel();
        return true;
      }
      const seamSym = blockadeMoveSymbol(blockade);
      const mover = this.state!.turn?.activeMover;
      if (seamSym && mover && mover.symbol === seamSym && mover.remaining >= blockade.cost) {
        this.act({ type: 'RemoveBlockade', blockadeId: blockade.id });
        return true;
      }
      const hand = this.me?.hand ?? [];
      const candidates = [...this.selected]
        .filter((cid) => hand.some((h) => h.id === cid))
        .map((cid) => ({ id: cid, defId: cardDefId(cid, this.state!) }));
      const pick = pickHandMover(seamSym, blockade.cost, candidates);
      if (pick) {
        this.selected.delete(pick.cardId);
        this.act({ type: 'RemoveBlockade', blockadeId: blockade.id, cardId: pick.cardId, symbol: pick.symbol });
        return true;
      }
      return false;
    }

    // Claimed: cross normally onto the far hex.
    const mover = this.state!.turn?.activeMover;
    if (mover && mover.remaining > 0) {
      const dest = this.blockadeDestination(blockade, mover.symbol, mover.remaining);
      if (dest) { this.act({ type: 'StepTo', to: { q: dest.q, r: dest.r } }); return true; }
    }
    const destGeo = this.blockadeDestination(blockade);
    if (!destGeo) return false;
    const req = this.movementRequirement(destGeo);
    const hand = this.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((cid) => hand.some((h) => h.id === cid))
      .map((cid) => ({ id: cid, defId: cardDefId(cid, this.state!) }));
    const pick = pickHandMover(req.required, req.cost, candidates);
    if (pick) {
      const pickDefId = candidates.find((c) => c.id === pick.cardId)!.defId;
      const dest = this.blockadeDestination(blockade, pick.symbol, getDef(pickDefId).power);
      if (!dest) return false;
      this.selected.delete(pick.cardId);
      this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
      this.act({ type: 'StepTo', to: { q: dest.q, r: dest.r } });
      return true;
    }
    return false;
  }

  private onCardClick(cardId: string): void {
    if (!this.isMyTurn()) return;
    if (this.mode === 'remove') {
      const handIds = new Set((this.me?.hand ?? []).map((c) => c.id));
      if (!handIds.has(cardId)) return;
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else if (this.selectedHandCardIds().length < this.removeAfterDrawLimit) this.selected.add(cardId);
      else this.flash(`最多移除 ${this.removeAfterDrawLimit} 张手牌`);
      this.renderHud();
      this.renderTerrainPanel();
      return;
    }
    if (this.mode === 'clear') {
      const cost = this.clearBlockadeId
        ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
        : this.hexAt(this.clearTarget!)?.cost ?? 0;
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else if (this.selected.size < cost) this.selected.add(cardId);
      else this.flash(`最多选择 ${cost} 张牌`);
      if (this.selected.size === cost) {
        if (this.clearBlockadeId) {
          this.act({ type: 'RemoveBlockade', blockadeId: this.clearBlockadeId, cardIds: [...this.selected] });
        } else if (this.clearTarget) {
          this.act({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.selected] });
        }
        return;
      }
      this.renderHud();
      this.renderTerrainPanel();
      return;
    }
    this.nativeActionCardId = null;
    if (this.selected.has(cardId)) this.selected.delete(cardId);
    else this.selected.add(cardId);
    this.promoteTargetDefId = null;
    if (this.selectedActionCard()?.def.ability !== 'take_free') this.buyTargetDefId = null;
    this.recomputeHighlights();
    this.renderHud();
    this.renderTerrainPanel();
  }

  private onMarketClick(defId: string): void {
    if (!this.state) return;
    if (!this.isMyTurn()) {
      this.previewMarketCard(defId);
      return;
    }
    if (this.mode === 'remove') {
      this.flash('请先处理要移除的手牌');
      return;
    }
    this.marketPreviewDefId = null;
    const pile = this.state?.market.find((m) => m.defId === defId);
    if (!pile || pile.count <= 0) {
      this.flash('这张牌当前无法选择');
      return;
    }
    if (this.selectedActionCard()?.def.ability === 'take_free') {
      this.promoteTargetDefId = null;
      this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
      this.hint = this.buyTargetDefId ? '点击「免费获得」使用发报机' : '';
      if (this.buyTargetDefId) this.mobilePanel = null;
      this.renderHud();
      return;
    }
    if (this.state!.turn?.hasBought) { this.flash('本回合已购买 · 每回合限买 1 张'); return; }
    if (!pile.onBoard) {
      this.buyTargetDefId = null;
      if (!this.marketNeedsPromotion(this.state!)) {
        this.marketPreviewDefId = defId;
        this.hint = '候补牌需要市场有空位才能放入';
        this.renderHud();
        return;
      }
      this.promoteTargetDefId = this.promoteTargetDefId === defId ? null : defId;
      this.hint = this.promoteTargetDefId ? '点击「放入市场」补位' : '';
      if (this.promoteTargetDefId) this.mobilePanel = null;
      this.renderHud();
      return;
    }
    this.promoteTargetDefId = null;
    this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
    this.hint = this.buyTargetDefId ? '选手牌支付，然后点「确认购买」' : '';
    if (this.buyTargetDefId) this.mobilePanel = null;
    this.renderHud();
  }

  private usesMarketPreviewFlow(): boolean {
    if (this.mobilePanel !== 'market') return false;
    return document.body.classList.contains('mobile-device')
      || window.matchMedia('(max-width: 760px)').matches
      || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
  }

  private previewMarketCard(defId: string): void {
    this.marketPreviewDefId = this.marketPreviewDefId === defId ? null : defId;
    if (this.marketPreviewDefId) {
      this.buyTargetDefId = null;
      this.promoteTargetDefId = null;
    }
    this.renderHud();
  }

  private selectMarketPreviewCard(): void {
    const defId = this.marketPreviewDefId;
    const state = this.state;
    if (!defId || !state) return;

    const pile = state.market.find((m) => m.defId === defId);
    this.marketPreviewDefId = null;
    if (!pile || pile.count <= 0) {
      this.flash('这张牌当前无法选择');
      return;
    }

    if (pile.onBoard) {
      this.onMarketClick(defId);
      return;
    }
    if (this.selectedActionCard()?.def.ability === 'take_free') {
      this.onMarketClick(defId);
      return;
    }
    this.onMarketClick(defId);
  }

  private canSelectMarketPreview(defId: string): boolean {
    if (!this.isMyTurn() || !this.state) return false;
    const pile = this.state.market.find((m) => m.defId === defId);
    if (!pile || pile.count <= 0) return false;
    if (this.selectedActionCard()?.def.ability === 'take_free') return true;
    if (this.state.turn?.hasBought) return false;
    if (pile.onBoard) return true;
    return this.marketNeedsPromotion(this.state);
  }

  private selectedActionCards(): Array<{ id: string; defId: string; def: ReturnType<typeof getDef> }> {
    const hand = this.me?.hand ?? [];
    return [...this.selected]
      .map((id) => {
        const card = hand.find((h) => h.id === id);
        if (!card) return null;
        const def = getDef(card.defId);
        return def.kind === 'action' ? { id, defId: card.defId, def } : null;
      })
      .filter((x): x is { id: string; defId: string; def: ReturnType<typeof getDef> } => !!x);
  }

  private selectedActionCard(): { id: string; defId: string; def: ReturnType<typeof getDef> } | null {
    const actions = this.selectedActionCards();
    return actions.length === 1 ? actions[0] : null;
  }

  private selectedActionRemoveIds(actionCardId: string): string[] {
    const handIds = new Set((this.me?.hand ?? []).map((c) => c.id));
    return [...this.selected].filter((id) => id !== actionCardId && handIds.has(id));
  }

  private removeLimitForAbility(ability: string | undefined): number {
    if (ability === 'draw1_remove1') return 1;
    if (ability === 'draw2_remove2') return 2;
    return 0;
  }

  private selectedActionUseLabel(compact = false): string {
    const action = this.selectedActionCard();
    if (!action) return compact ? '使用' : '使用行动牌';
    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        return compact ? '摸牌' : `使用${action.def.name}`;
      case 'draw1_remove1':
      case 'draw2_remove2':
        return compact ? '使用' : `使用${action.def.name}`;
      case 'take_free':
        return compact ? '免费拿' : (this.buyTargetDefId ? `免费获得${getDef(this.buyTargetDefId).name}` : '选择市场卡');
      case 'native':
        return compact ? '向导' : '使用原住民向导';
      default:
        return compact ? '使用' : `使用${action.def.name}`;
    }
  }

  private handActionUseLabel(def: ReturnType<typeof getDef>): string {
    switch (def.ability) {
      case 'draw2':
      case 'draw3':
        return '摸牌';
      case 'take_free':
        return '免费拿';
      case 'native':
        return '向导';
      default:
        return '使用';
    }
  }

  private canUseSelectedAction(): boolean {
    const actions = this.selectedActionCards();
    if (actions.length !== 1) return false;
    const action = actions[0];
    const removeIds = this.selectedActionRemoveIds(action.id);
    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        return removeIds.length === 0;
      case 'draw1_remove1':
      case 'draw2_remove2':
        return removeIds.length === 0;
      case 'take_free':
        return !!this.buyTargetDefId;
      case 'native':
        return true;
      default:
        return false;
    }
  }

  private useActionCardFromHand(cardId: string): void {
    if (!this.isMyTurn()) return;
    if (this.mode === 'remove') {
      this.flash('请先处理要移除的手牌');
      return;
    }
    const hand = this.me?.hand ?? [];
    const card = hand.find((c) => c.id === cardId);
    if (!card) return;
    const def = getDef(card.defId);
    if (def.kind !== 'action') return;

    this.nativeActionCardId = null;
    this.promoteTargetDefId = null;
    if (def.ability !== 'take_free') this.buyTargetDefId = null;

    if (
      def.ability === 'draw2'
      || def.ability === 'draw3'
      || def.ability === 'draw1_remove1'
      || def.ability === 'draw2_remove2'
    ) {
      this.selected = new Set([cardId]);
    } else {
      const handIds = new Set(hand.map((c) => c.id));
      const selectedNonActions = [...this.selected].filter((id) => {
        if (id === cardId || !handIds.has(id)) return false;
        const selectedCard = hand.find((h) => h.id === id);
        return selectedCard ? getDef(selectedCard.defId).kind !== 'action' : false;
      });
      this.selected = new Set([...selectedNonActions, cardId]);
    }

    this.useSelectedAction();
  }

  private useSelectedAction(): void {
    if (this.mode === 'remove') {
      this.flash('请先处理要移除的手牌');
      return;
    }
    const actions = this.selectedActionCards();
    if (actions.length === 0) {
      this.flash('先选择一张行动牌');
      return;
    }
    if (actions.length > 1) {
      this.flash('一次只能使用一张行动牌');
      return;
    }
    const action = actions[0];
    const removeCardIds = this.selectedActionRemoveIds(action.id);

    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        if (removeCardIds.length > 0) {
          this.flash('这张行动牌不需要选择其他手牌');
          return;
        }
        this.act({ type: 'UseAbility', cardId: action.id });
        return;
      case 'draw1_remove1':
      case 'draw2_remove2': {
        if (removeCardIds.length > 0) {
          this.flash('先使用行动牌，摸牌后再选择要移除的手牌');
          return;
        }
        this.act({ type: 'UseAbility', cardId: action.id });
        return;
      }
      case 'take_free':
        if (!this.buyTargetDefId) {
          this.mobilePanel = 'market';
          this.flash('先选择一张市场卡');
          this.renderHud();
          return;
        }
        this.act({ type: 'UseAbility', cardId: action.id, takeDefId: this.buyTargetDefId });
        this.buyTargetDefId = null;
        return;
      case 'native':
        this.nativeActionCardId = action.id;
        this.hint = '点选一个相邻地形，使用原住民向导移动';
        this.recomputeHighlights();
        this.renderHud();
        return;
      default:
        this.flash('这个行动牌能力尚未实现');
    }
  }

  private promoteMarket(defId: string): void {
    if (!this.isMyTurn()) return;
    if (this.mode === 'remove') {
      this.flash('请先处理要移除的手牌');
      return;
    }
    if (this.state!.turn?.hasBought) {
      this.flash('购买后不能补位 · 由下一位玩家选择');
      return;
    }
    if (!this.marketNeedsPromotion(this.state!)) {
      this.flash('当前市场没有空位');
      return;
    }
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.hint = '';
    this.act({ type: 'PromoteMarket', defId });
  }

  private confirmPromoteMarket(): void {
    if (!this.promoteTargetDefId) return;
    this.promoteMarket(this.promoteTargetDefId);
  }

  private confirmBuy(): void {
    if (!this.buyTargetDefId) return;
    if (this.mode === 'remove') {
      this.flash('请先处理要移除的手牌');
      return;
    }
    this.act({ type: 'BuyCard', defId: this.buyTargetDefId, paymentCardIds: [...this.selected] });
  }

  private confirmRemoveAfterDraw(): void {
    if (!this.isMyTurn() || this.mode !== 'remove') return;
    const cardIds = this.selectedHandCardIds();
    if (cardIds.length > this.removeAfterDrawLimit) {
      this.flash(`最多移除 ${this.removeAfterDrawLimit} 张手牌`);
      return;
    }
    this.act({ type: 'RemoveCards', cardIds });
  }

  private cancelMode(): void {
    this.resetSelection();
    this.renderHud();
    this.recomputeHighlights();
  }

  private closeMobilePanel(): void {
    this.mobilePanel = null;
    this.marketPreviewDefId = null;
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
  /** Briefly show a transient hint toast. */
  private flash(msg: string): void {
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
    return this.selected.size > 0 || !!this.buyTargetDefId || !!this.promoteTargetDefId || !!this.marketPreviewDefId;
  }

  private attachPreview(node: HTMLElement, defId: string): void {
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
  private refreshPinnedPreview(): void {
    if (this.selected.size === 1 && this.state) {
      const id = [...this.selected][0];
      const node = this.handEls.get(id);
      if (node) return this.showPreview(node, cardDefId(id, this.state));
    }
    if (this.buyTargetDefId) {
      const node = this.shopEls.get(this.buyTargetDefId);
      if (node) return this.showPreview(node, this.buyTargetDefId);
    }
    if (this.promoteTargetDefId) {
      const node = this.shopEls.get(this.promoteTargetDefId);
      if (node) return this.showPreview(node, this.promoteTargetDefId);
    }
    if (this.marketPreviewDefId) {
      const node = this.shopEls.get(this.marketPreviewDefId);
      if (node) return this.showPreview(node, this.marketPreviewDefId);
    }
    this.hidePreview();
  }

  private showPreview(anchor: HTMLElement, defId: string): void {
    const compactLandscape = this.isCompactLandscape();
    const marketPreview = this.usesMarketPreviewFlow();

    this.preview.innerHTML = previewHtml(defId);
    this.preview.classList.toggle('actionable', marketPreview && this.canSelectMarketPreview(defId));
    if (marketPreview && this.canSelectMarketPreview(defId)) {
      const pile = this.state?.market.find((m) => m.defId === defId);
      const promote = !!pile && !pile.onBoard && this.marketNeedsPromotion(this.state!) && !this.state!.turn?.hasBought;
      const select = button(promote ? '放入市场' : '选择卡牌', () => this.selectMarketPreviewCard(), false);
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

  private hidePreview(): void {
    this.preview.classList.add('hidden');
    this.preview.classList.remove('actionable');
  }

  // --- rendering: lobby ---

  /**
   * Freeze the current lobby screen in place and lay a game-style "正在开始"
   * crest over it. Not a separate layer — it dims/blurs the existing lobby modal
   * (via the `launching` class) and appends the crest inside #lobby, so the same
   * screen the player is looking at simply locks until board state arrives.
   */
  private beginStarting(): void {
    if (this.starting || this.state) return;
    this.starting = true;
    this.lobby.classList.remove('hidden');
    this.lobby.classList.add('launching');
    if (!this.lobby.querySelector('.lobby-launch')) {
      const crest = el('div', 'lobby-launch');
      crest.innerHTML = `
        <div class="lobby-launch-crest">
          <div class="lobby-launch-ring"><span>🧭</span></div>
          <div class="lobby-launch-title">正在开始</div>
          <div class="lobby-launch-copy">正在集结探险队，进入黄金城之路…</div>
        </div>`;
      this.lobby.appendChild(crest);
    }
    // Safety: never strand the player on a frozen lobby if state never arrives.
    clearTimeout(this.startingTimer);
    this.startingTimer = setTimeout(() => this.endStarting(), 8000);
  }

  private endStarting(): void {
    if (!this.starting && !this.lobby.classList.contains('launching')) return;
    this.starting = false;
    clearTimeout(this.startingTimer);
    this.lobby.classList.remove('launching');
    this.lobby.querySelector('.lobby-launch')?.remove();
  }

  private renderLobby(): void {
    const inLobby = !this.state || this.state.phase !== 'playing';
    this.lobby.classList.toggle('hidden', !inLobby && !!this.state);
    this.renderTerrainPanel();
    if (this.room && this.room.phase !== 'lobby') {
      this.lobby.classList.add('hidden');
      return;
    }

    const isHost = this.room?.hostId === this.you;
    this.lobby.innerHTML = '';
    const modal = el('div', 'modal');
    modal.classList.add('lobby-modal');
    modal.classList.add(this.room ? 'room-modal' : 'entry-modal');
    const artHtml = `
      <div class="lobby-art"></div>`;

    if (!this.room) {
      modal.innerHTML = `
        ${artHtml}
        <div class="lobby-form">
          <h1>冲向黄金城</h1>
          <label>你的名字</label>
          <span class="game-field"><input id="name" value="${escapeHtml(this.nameValue)}" placeholder="玩家名" /></span>
          <label>房间码（加入已有房间）</label>
          <span class="game-field"><input id="code" placeholder="请输入 4 位房间码" maxlength="4" style="text-transform:uppercase" /></span>
          <div class="row">
            <button id="create">创建房间</button>
            <button id="join" class="secondary">加入房间</button>
          </div>
          <div class="error">${escapeHtml(this.error)}</div>
        </div>`;
      modal.querySelector<HTMLInputElement>('#name')!.oninput = (e) => {
        this.nameValue = (e.target as HTMLInputElement).value;
        localStorage.setItem('eldorado.name', this.nameValue);
      };
      modal.querySelector<HTMLButtonElement>('#create')!.onclick = () => {
        this.net.send({ type: 'createRoom', name: this.nameValue || '玩家' });
        this.net.send({ type: 'setAiDelay', ms: this.aiDelay });
      };
      modal.querySelector<HTMLButtonElement>('#join')!.onclick = () => {
        const code = modal.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        if (code) this.net.send({ type: 'joinRoom', code, name: this.nameValue || '玩家' });
      };
    } else {
      const players = this.room.players
        .map(
          (p) =>
            `<div class="player-chip"><span class="dot" style="background:${colorHex(p.color)}"></span>${escapeHtml(
              playerDisplayName(p),
            )}${p.isAI ? ' 🤖' : ''}${p.offline ? ' · 离线' : ''}${p.id === this.room!.hostId ? ' 👑' : ''}</div>`,
        )
        .join('');
      const selectedMap = MAP_OPTIONS.find((map) => map.id === this.selectedMapId) ?? MAP_OPTIONS[0];
      modal.innerHTML = `
        ${artHtml}
        <div class="lobby-form">
          <h1>房间 <span class="room-code">${this.room.code}</span></h1>
          ${
            isHost
              ? `<label for="map-select">地图</label>
                <div class="map-picker" id="map-picker">
                  <button id="map-select" class="map-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
                    <span class="map-trigger-mark" aria-hidden="true"></span>
                    <span class="map-trigger-name">${escapeHtml(selectedMap.name)}</span>
                    <i aria-hidden="true"></i>
                  </button>
                  <div class="map-menu" role="listbox" aria-label="选择地图">
                    ${MAP_OPTIONS.map(
                      (map) =>
                        `<button type="button" class="map-option ${map.id === this.selectedMapId ? 'selected' : ''}" data-map-id="${escapeHtml(
                          map.id,
                        )}" role="option" aria-selected="${map.id === this.selectedMapId ? 'true' : 'false'}">
                          <span class="map-option-mark" aria-hidden="true"></span>
                          <span class="map-option-name">${escapeHtml(map.name)}</span>
                          ${map.id === this.selectedMapId ? '<b>当前</b>' : ''}
                        </button>`,
                    ).join('')}
                  </div>
                </div>`
              : ''
          }
          <div class="lobby-players">${players}</div>
          <div class="row">
            ${isHost ? '<button id="ai" class="secondary">+ 添加电脑</button>' : ''}
            ${isHost ? `<button id="start" ${this.room.players.length < 2 ? 'disabled' : ''}>开始游戏</button>` : '<div class="sub">等待房主开始…</div>'}
          </div>
          <div class="error">${escapeHtml(this.error)}</div>
        </div>`;
      if (isHost) {
        modal.querySelector<HTMLButtonElement>('#ai')!.onclick = () => this.net.send({ type: 'addAI' });
        const mapPicker = modal.querySelector<HTMLElement>('#map-picker');
        const mapTrigger = modal.querySelector<HTMLButtonElement>('#map-select');
        if (mapPicker && mapTrigger) {
          const setOpen = (open: boolean) => {
            mapPicker.classList.toggle('open', open);
            modal.classList.toggle('map-menu-open', open);
            mapTrigger.setAttribute('aria-expanded', String(open));
          };
          mapTrigger.onclick = (e) => {
            e.stopPropagation();
            setOpen(!mapPicker.classList.contains('open'));
          };
          for (const option of modal.querySelectorAll<HTMLButtonElement>('.map-option')) {
            option.onclick = (e) => {
              e.stopPropagation();
              this.selectedMapId = safeMapId(option.dataset.mapId ?? null);
              localStorage.setItem('eldorado.mapId', this.selectedMapId);
              this.renderLobby();
            };
          }
          modal.addEventListener('click', (e) => {
            if (!mapPicker.contains(e.target as Node)) setOpen(false);
          });
        }
        const startBtn = modal.querySelector<HTMLButtonElement>('#start');
        if (startBtn)
          startBtn.onclick = () => {
            this.beginStarting(); // optimistic freeze covers the server round-trip
            this.net.send({ type: 'startGame', mapId: this.selectedMapId });
          };
      }
    }
    this.lobby.appendChild(modal);
  }

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

  private renderActionLog(): void {
    const panel = el('div', 'action-log panel');
    panel.innerHTML = '<h3>行动日志</h3>';
    const list = el('div', 'action-log-list');
    if (this.actionLog.length > 0) {
      for (const entry of this.actionLog.slice(-24)) {
        const row = el('div', 'action-log-entry');
        row.style.setProperty('--log-player', entry.playerColor);

        const dot = document.createElement('span');
        dot.className = 'action-log-dot';
        row.appendChild(dot);

        const body = el('div', 'action-log-body');
        const player = el('div', 'action-log-player');
        player.textContent = entry.playerName;
        const text = el('div', 'action-log-text');
        for (const segment of entry.segments) {
          const node = document.createElement('span');
          node.textContent = segment.text;
          const classes: string[] = [];
          if (segment.defId) {
            classes.push('action-log-card');
            this.attachPreview(node, segment.defId);
          }
          if (segment.coord || segment.blockadeId) {
            classes.push('action-log-terrain');
            node.addEventListener('mouseenter', () => {
              if (segment.blockadeId) this.board.setInfoHoverBlockade(segment.blockadeId);
              else if (segment.coord) this.board.setInfoHoverHex(segment.coord);
            });
            node.addEventListener('mouseleave', () => this.board.clearInfoHover());
          }
          if (classes.length) node.className = classes.join(' ');
          text.appendChild(node);
        }
        body.appendChild(player);
        body.appendChild(text);
        row.appendChild(body);
        list.appendChild(row);
      }
    }
    panel.appendChild(list);
    this.hud.appendChild(panel);
    list.scrollTop = list.scrollHeight;
  }

  private renderHud(): void {
    this.hidePreview();
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

    // --- mobile toolbar (market sheet toggle) ---
    const toolbar = el('div', 'mobile-toolbar');
    const mbtn = button('🛒 市场', () => {
      this.mobilePanel = this.mobilePanel === 'market' ? null : 'market';
      if (this.mobilePanel !== 'market') this.marketPreviewDefId = null;
      this.renderHud();
    });
    if (this.mobilePanel === 'market') mbtn.classList.add('active');
    toolbar.appendChild(mbtn);
    this.hud.appendChild(toolbar);

    // --- top-centre: players as cards ---
    this.playerCardEls.clear();
    const pcards = el('div', 'player-cards');
    const turnRank = new Map(s.turnOrder.map((id, i) => [id, i]));
    const orderedPlayers = s.players
      .slice()
      .sort((a, b) => (turnRank.get(a.id) ?? Infinity) - (turnRank.get(b.id) ?? Infinity));
    for (const p of orderedPlayers) {
      const active = p.id === s.turn?.playerId;
      const card = el('div', `pcard ${active ? 'active' : ''} ${p.finished ? 'finished' : ''}`);
      card.style.setProperty('--pc', colorHex(p.color));
      const tags = `${p.isAI ? '<span class="ptag">电脑</span>' : ''}${p.offline ? '<span class="ptag offline">离线</span>' : ''}${p.id === this.you ? '<span class="ptag you">你</span>' : ''}`;
      card.innerHTML = `
        <div class="pc-top">
          <span class="pc-dot"></span>
          <span class="pc-name">${escapeHtml(playerDisplayName(p))}</span>
          ${tags}
          <span class="pc-flag">${p.finished ? '🏆' : active ? '▶' : ''}</span>
        </div>
        <div class="pc-counts">
          <span><b>牌库</b>${p.deck.length + p.hand.length}</span>
          <span><b>弃牌</b>${p.discard.length}</span>
          <span><b>阻挡物</b>${p.blockades}</span>
        </div>
        <div class="pc-progress"><span style="width:${Math.round(this.progressOf(p) * 100)}%"></span></div>`;
      pcards.appendChild(card);
      this.playerCardEls.set(p.id, card);
    }
    this.hud.appendChild(pcards);

    // --- right: market (all 18 cards; on-board buyable, others upcoming) ---
    const market = el('div', `market-panel panel ${this.mobilePanel === 'market' ? 'open' : ''}`);
    const onBoard = s.market.filter((m) => m.onBoard && m.count > 0);
    const upcoming = s.market.filter((m) => !m.onBoard && m.count > 0);
    const needsPromotion = onBoard.length < 6 && upcoming.length > 0;
    const canPromote = myTurn && needsPromotion && !s.turn?.hasBought;
    const freeTakeAction = this.selectedActionCard()?.def.ability === 'take_free';
    const shopCard = (pile: (typeof s.market)[number], locked: boolean): HTMLDivElement => {
      const def = getDef(pile.defId);
      const sub = def.kind === 'action' ? '行动牌' : def.power ? `力量 ${def.power}` : '';
      const cls = locked ? (canPromote ? 'promotable' : 'upcoming') : pile.count === 0 ? 'sold' : '';
      const left = locked ? (canPromote ? '补位' : '候补') : `×${pile.count}`;
      const card = el(
        'div',
        `shop-card ${this.buyTargetDefId === pile.defId || this.promoteTargetDefId === pile.defId ? 'target' : ''} ${this.marketPreviewDefId === pile.defId ? 'previewing' : ''} ${cls}`,
      );
      card.innerHTML = `
        <span class="ic card-thumb">${cardFace(def)}</span>
        <span class="nm">${escapeHtml(def.name)}<small>${sub}${def.singleUse ? ' · 单次' : ''}</small></span>
        <span class="price"><span class="c">${def.cost}💰</span><span class="left">${left}</span></span>`;
      if (this.usesMarketPreviewFlow()) {
        card.onclick = () => this.previewMarketCard(pile.defId);
      } else if (freeTakeAction && myTurn && pile.count > 0) {
        card.onclick = () => this.onMarketClick(pile.defId);
      } else if (locked && canPromote) card.onclick = () => this.onMarketClick(pile.defId);
      else if (locked) card.onclick = () => this.previewMarketCard(pile.defId);
      else if (!locked && pile.count > 0 && myTurn) card.onclick = () => this.onMarketClick(pile.defId);
      this.attachPreview(card, pile.defId);
      this.shopEls.set(pile.defId, card);
      return card;
    };
    const bought = myTurn && !!s.turn?.hasBought;
    const marketTitle = needsPromotion
      ? canPromote ? '在售有空位' : '候补市场'
      : bought ? '本回合已购买' : '在售';
    market.innerHTML = `<h3>市场 · ${marketTitle}</h3>`;
    for (const pile of onBoard) market.appendChild(shopCard(pile, false));
    if (upcoming.length) {
      const sub = el('h3', '');
      sub.textContent = `${canPromote ? '候补可补位' : '候补市场'} · ${upcoming.length}`;
      sub.style.marginTop = '14px';
      market.appendChild(sub);
      for (const pile of upcoming) market.appendChild(shopCard(pile, true));
    }
    this.hud.appendChild(market);

    // Mobile: a tap-to-dismiss scrim + swipe-down-to-close on the open sheet.
    if (this.mobilePanel === 'market') {
      const scrim = el('div', 'sheet-scrim');
      scrim.onclick = () => this.closeMobilePanel();
      this.hud.appendChild(scrim);
      this.attachSheetDismiss(market);
    }

    this.renderActionLog();

    // (draw/discard piles are built into the bottom dock, flanking the hand)

    // --- bottom dock: hand + actions ---
    const dock = el('div', 'dock');
    const me = this.me;
    const tray = el('div', 'hand-tray');
    tray.addEventListener('wheel', (ev) => {
      if (tray.scrollWidth <= tray.clientWidth || Math.abs(ev.deltaX) >= Math.abs(ev.deltaY)) return;
      tray.scrollLeft += ev.deltaY;
      ev.preventDefault();
    }, { passive: false });
    if (me) {
      for (const c of me.hand) {
        const def = getDef(c.defId);
        const selected = this.selected.has(c.id);
        const card = el('div', `card ${def.kind} ${selected ? 'selected' : ''}`);
        card.innerHTML = `
          ${cardFace(def)}`;
        if (myTurn) card.onclick = () => this.onCardClick(c.id);
        if (myTurn && s.phase === 'playing' && def.kind === 'action' && this.mode !== 'remove') {
          const use = document.createElement('button');
          use.type = 'button';
          use.className = 'card-use-btn';
          use.textContent = this.handActionUseLabel(def);
          use.onclick = (ev) => {
            ev.stopPropagation();
            this.useActionCardFromHand(c.id);
          };
          card.appendChild(use);
        }
        this.attachPreview(card, c.defId);
        this.handEls.set(c.id, card);
        tray.appendChild(card);
      }
    }

    const bar = el('div', 'action-bar command-panel');
    const ctx = el('div', 'ctx command-state');
    ctx.innerHTML = this.commandStateHtml(myTurn, turnName);
    bar.appendChild(ctx);
    const actions = el('div', 'command-actions');
    if (myTurn && s.phase === 'playing') {
      if (this.mode === 'remove') {
        const removeCount = this.selectedHandCardIds().length;
        const confirm = button(
          removeCount > 0 ? `确认移除 ${removeCount}/${this.removeAfterDrawLimit}` : '跳过移除',
          () => this.confirmRemoveAfterDraw(),
          false,
        );
        confirm.className = 'gold cmd-btn';
        actions.appendChild(confirm);
      } else if (this.mode === 'clear') {
        const cancel = button('取消', () => this.cancelMode(), true);
        cancel.classList.add('cmd-btn');
        actions.appendChild(cancel);
      } else {
        const compact = this.isCompactCommandLayout();
        if (this.promoteTargetDefId) {
          const promote = button(compact ? '放入' : '放入市场', () => this.confirmPromoteMarket(), false);
          promote.className = 'gold cmd-btn';
          actions.appendChild(promote);
        }
        if (this.buyTargetDefId) {
          const cost = getDef(this.buyTargetDefId).cost;
          const have = [...this.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
          const buy = button(compact ? `购买 ${have}/${cost}` : `确认购买 (${have}/${cost}💰)`, () => this.confirmBuy(), false);
          buy.className = 'gold cmd-btn';
          buy.disabled = have < cost;
          actions.appendChild(buy);
        }
        if (this.selectedActionCards().length > 0 || this.nativeActionCardId) {
          const use = button(this.nativeActionCardId ? (compact ? '选目标' : '选择向导目标') : this.selectedActionUseLabel(compact), () => this.useSelectedAction(), false);
          use.className = 'gold cmd-btn';
          use.disabled = !!this.nativeActionCardId || !this.canUseSelectedAction();
          actions.appendChild(use);
        }
        const end = button(compact ? '结束' : '结束回合', () => this.act({ type: 'EndTurn' }), true);
        end.classList.add('cmd-btn');
        actions.appendChild(end);
        const skill = button('弃牌', () => {
          if (this.selected.size === 0) return;
          this.act({ type: 'DiscardCards', cardIds: [...this.selected] });
        }, true);
        skill.classList.add('cmd-btn');
        skill.disabled = this.selected.size === 0;
        actions.appendChild(skill);
      }
    }
    bar.appendChild(actions);
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
    this.renderTerrainPanel();
  }

  private commandStateHtml(myTurn: boolean, turnName: string): string {
    const s = this.state;
    if (!s) return '';
    if (s.phase === 'finished') return '<b>游戏结束</b><span>结算完成</span>';
    if (!myTurn) return `<b>等待行动</b><span>${escapeHtml(turnName)}</span>`;
    if (this.mode === 'remove') {
      return `<b>移除手牌</b><span>${this.selectedHandCardIds().length}/${this.removeAfterDrawLimit} 张，可跳过</span>`;
    }
    if (this.mode === 'clear') {
      const cost = this.clearBlockadeId
        ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
        : this.hexAt(this.clearTarget!)?.cost ?? 0;
      const verb = this.clearBlockadeId ? '移除连接地形' : '清除地形';
      return `<b>${verb}</b><span>${this.selected.size}/${cost} 张牌</span>`;
    }
    if (this.promoteTargetDefId) {
      return `<b>放入市场</b><span>${escapeHtml(getDef(this.promoteTargetDefId).name)}</span>`;
    }
    if (this.buyTargetDefId) {
      const cost = getDef(this.buyTargetDefId).cost;
      const have = [...this.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
      if (this.selectedActionCard()?.def.ability === 'take_free') {
        return `<b>发报机目标</b><span>${escapeHtml(getDef(this.buyTargetDefId).name)}</span>`;
      }
      return `<b>购买 ${escapeHtml(getDef(this.buyTargetDefId).name)}</b><span>${have}/${cost} 金币</span>`;
    }
    if (this.nativeActionCardId) {
      return '<b>原住民向导</b><span>点选一个相邻地形</span>';
    }
    const actionCards = this.selectedActionCards();
    if (actionCards.length > 1) {
      return '<b>行动牌</b><span>一次只能使用 1 张</span>';
    }
    if (actionCards.length === 1) {
      const action = actionCards[0];
      const removeIds = this.selectedActionRemoveIds(action.id);
      const limit = this.removeLimitForAbility(action.def.ability);
      if (limit > 0) {
        return removeIds.length > 0
          ? `<b>使用 ${escapeHtml(action.def.name)}</b><span>先只选择这张行动牌</span>`
          : `<b>使用 ${escapeHtml(action.def.name)}</b><span>先摸牌，再选择移除</span>`;
      }
      if (action.def.ability === 'take_free') {
        return `<b>使用 ${escapeHtml(action.def.name)}</b><span>先选择市场卡</span>`;
      }
      if (action.def.ability === 'native') {
        return `<b>使用 ${escapeHtml(action.def.name)}</b><span>点击使用后选地形</span>`;
      }
      return `<b>使用 ${escapeHtml(action.def.name)}</b><span>点击使用行动牌</span>`;
    }
    const mover = s.turn?.activeMover;
    if (mover) {
      return `<b>${SYMBOL_GLYPH[mover.symbol]} ${SYMBOL_LABEL[mover.symbol]}</b><span>剩余 ${mover.remaining} 点</span>`;
    }
    if (this.selected.size > 0) return `<b>已选手牌</b><span>${this.selected.size} 张可用于行动</span>`;
    if (myTurn && !s.turn?.hasBought && this.marketNeedsPromotion(s)) {
      return '<b>市场有空位</b><span>可买在售牌，或放入候补牌</span>';
    }
    return '<b>你的回合</b><span>选择手牌或目标地形</span>';
  }

  private renderGameOverOverlay(s: GameState): void {
    const winner = s.winnerId ? s.players.find((p) => p.id === s.winnerId) : null;
    const ranked = [...s.players].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (b.blockades !== a.blockades) return b.blockades - a.blockades;
      return (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity);
    });
    const rows = ranked
      .map(
        (p, i) => `
          <div class="end-row">
            <span class="end-rank">${i + 1}</span>
            <span class="end-dot" style="background:${colorHex(p.color)}"></span>
            <span class="end-name">${escapeHtml(playerDisplayName(p))}${p.offline ? ' · 离线' : ''}</span>
            <span class="end-score">${p.finished ? `第 ${p.finishedAt} 回合` : '未抵达'} · ${p.blockades} 阻挡物</span>
          </div>`,
      )
      .join('');
    const overlay = el('div', 'end-overlay');
    overlay.innerHTML = `
      <div class="end-modal">
        <div class="end-kicker">游戏已经结束</div>
        <h2>${winner ? `${escapeHtml(playerDisplayName(winner))} 抵达黄金城` : '无人抵达黄金城'}</h2>
        <div class="end-sub">最终排名</div>
        <div class="end-list">${rows}</div>
        <div class="end-actions"></div>
      </div>`;
    const actionWrap = overlay.querySelector<HTMLDivElement>('.end-actions')!;
    const roomBtn = button('返回房间', () => this.returnToLobby(), false);
    roomBtn.className = 'gold';
    const lobbyBtn = button('返回大厅', () => this.leaveRoom(), true);
    actionWrap.appendChild(roomBtn);
    actionWrap.appendChild(lobbyBtn);
    this.hud.appendChild(overlay);
  }

  private cancelTerrainHoverClear(): void {
    clearTimeout(this.terrainHoverClearTimer);
    this.terrainHoverClearTimer = undefined;
  }

  private scheduleTerrainHoverClear(): void {
    this.cancelTerrainHoverClear();
    this.terrainHoverClearTimer = setTimeout(() => {
      this.terrainHoverClearTimer = undefined;
      if (this.terrainPanelHovering) return;
      this.hoveredTerrain = null;
      this.hoveredBlockadeId = null;
      this.board.clearInfoHover();
      this.renderTerrainPanel();
      if (!this.pinnedTerrain && !this.pinnedBlockadeId) this.refreshPinnedPreview();
    }, 80);
  }

  private bindTerrainPanelHover(coord: Axial | null, blockadeId: string | null): void {
    const enter = () => {
      this.terrainPanelHovering = true;
      this.cancelTerrainHoverClear();
      if (blockadeId) this.board.setInfoHoverBlockade(blockadeId);
      else if (coord) this.board.setInfoHoverHex(coord);
    };
    this.terrainPanel.onmouseenter = enter;
    this.terrainPanel.onmouseleave = () => {
      this.terrainPanelHovering = false;
      this.board.clearInfoHover();
      if (!this.pinnedTerrain && !this.pinnedBlockadeId) {
        this.hoveredTerrain = null;
        this.hoveredBlockadeId = null;
        this.renderTerrainPanel();
        this.refreshPinnedPreview();
      }
    };
    if (this.terrainPanel.matches(':hover')) enter();
  }

  private closeTerrainPanel(): void {
    this.cancelTerrainHoverClear();
    this.terrainPanelHovering = false;
    this.pinnedTerrain = null;
    this.hoveredTerrain = null;
    this.pinnedBlockadeId = null;
    this.hoveredBlockadeId = null;
    this.board.setInspectedHex(null);
    this.board.setInspectedBlockade(null);
    this.board.clearInfoHover();
    this.renderTerrainPanel();
    this.refreshPinnedPreview();
  }

  private renderTerrainPanel(): void {
    if (this.pinnedTerrain && !this.hexAt(this.pinnedTerrain)) this.pinnedTerrain = null;
    if (this.hoveredTerrain && !this.hexAt(this.hoveredTerrain)) this.hoveredTerrain = null;
    if (this.pinnedBlockadeId && !this.blockadeById(this.pinnedBlockadeId)) {
      this.pinnedBlockadeId = null;
      this.board.setInspectedBlockade(null);
    }
    if (this.hoveredBlockadeId && !this.blockadeById(this.hoveredBlockadeId)) this.hoveredBlockadeId = null;

    const activeBlockade = this.blockadeById(this.hoveredBlockadeId ?? this.pinnedBlockadeId);
    const activeCoord = activeBlockade ? null : this.hoveredTerrain ?? this.pinnedTerrain;
    const hex = activeCoord ? this.hexAt(activeCoord) : undefined;
    if (!this.state || this.state.phase === 'lobby' || (!hex && !activeBlockade)) {
      this.cancelTerrainHoverClear();
      this.terrainPanelHovering = false;
      this.terrainPanel.onmouseenter = null;
      this.terrainPanel.onmouseleave = null;
      this.terrainPanel.classList.add('hidden');
      this.terrainPanel.innerHTML = '';
      if (!hex) this.board.setInspectedHex(null);
      if (!activeBlockade) this.board.setInspectedBlockade(null);
      this.board.clearInfoHover();
      return;
    }

    this.hidePreview();
    if (activeBlockade) {
      const terrain = blockadeTerrain(activeBlockade);
      const info = blockadeInfo(activeBlockade);
      const pinned = !!this.pinnedBlockadeId && !this.hoveredBlockadeId;
      const owner = activeBlockade.claimedBy ? this.state.players.find((p) => p.id === activeBlockade.claimedBy) : null;
      const ownerText = owner ? `归属：${playerDisplayName(owner)}` : '尚未被领取';
      const edgeCount = this.blockadeEdges(activeBlockade).length;
      this.terrainPanel.classList.remove('hidden');
      this.terrainPanel.classList.toggle('pinned', pinned);
      this.terrainPanel.innerHTML = `
        <div class="terrain-head">
          <div class="terrain-icon terrain-${terrain}">${info.icon}</div>
          <div class="terrain-title-wrap">
            <div class="terrain-kicker">${pinned ? '点击固定' : '悬浮查看'}</div>
            <div class="terrain-title">${escapeHtml(info.name)}</div>
          </div>
          <button class="terrain-close" aria-label="关闭地形说明">×</button>
        </div>
        <div class="terrain-desc">${escapeHtml(info.description)}</div>
        <div class="terrain-rule"><b>规则</b><span>${escapeHtml(info.rule)}</span></div>
        <div class="terrain-meta">
          <span>${escapeHtml(blockadeCostText(activeBlockade))}</span>
          <span>${escapeHtml(ownerText)}</span>
          <span>连接 ${edgeCount} 条边</span>
        </div>
        <div class="terrain-status">${escapeHtml(this.blockadeActionStatus(activeBlockade))}</div>`;
      this.terrainPanel.querySelector<HTMLButtonElement>('.terrain-close')!.onclick = () => this.closeTerrainPanel();
      this.bindTerrainPanelHover(null, activeBlockade.id);
      return;
    }
    if (!hex) return;

    const info = terrainInfo(hex);
    const pinned = !!this.pinnedTerrain && !this.hoveredTerrain;
    const occupant = hex.occupant ? this.state.players.find((p) => p.id === hex.occupant) : null;
    const occupantText = occupant ? `占据：${playerDisplayName(occupant)}` : '未被占据';
    const status = this.terrainActionStatus(hex);
    this.terrainPanel.classList.remove('hidden');
    this.terrainPanel.classList.toggle('pinned', pinned);
    this.terrainPanel.innerHTML = `
      <div class="terrain-head">
        <div class="terrain-icon terrain-${hex.terrain}">${info.icon}</div>
        <div class="terrain-title-wrap">
          <div class="terrain-kicker">${pinned ? '点击固定' : '悬浮查看'}</div>
          <div class="terrain-title">${escapeHtml(info.name)}</div>
        </div>
        <button class="terrain-close" aria-label="关闭地形说明">×</button>
      </div>
      <div class="terrain-desc">${escapeHtml(info.description)}</div>
      <div class="terrain-rule"><b>规则</b><span>${escapeHtml(info.rule)}</span></div>
      <div class="terrain-meta">
        <span>${escapeHtml(terrainCostText(hex))}</span>
        <span>${escapeHtml(occupantText)}</span>
        <span>坐标 ${hex.q}, ${hex.r}</span>
      </div>
      <div class="terrain-status">${escapeHtml(status)}</div>`;
    this.terrainPanel.querySelector<HTMLButtonElement>('.terrain-close')!.onclick = () => this.closeTerrainPanel();
    this.bindTerrainPanelHover({ q: hex.q, r: hex.r }, null);
  }

  private blockadeActionStatus(blockade: Blockade): string {
    if (!this.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    if (this.mode === 'clear') return '你正在清除地形，点击手牌支付费用。点击连接地形只会固定说明。';
    if (this.mode === 'remove') return '正在处理行动牌摸牌后的移除选择，完成后才能继续执行地形行动。';
    if (blockade.claimedBy) return '这块连接地形已经被领取，不再作为可领取阻挡物。';
    if (!this.blockadeDestination(blockade)) return '当前棋子不在这块连接地形覆盖的边旁边，暂时不能行动。';

    const requirementText = `连接地形需要 ${blockadeCostText(blockade)}；第一个移除的玩家会领取它，玩家信息中的阻挡物数量会增加。`;
    if (blockadeRequiresDiscard(blockade)) {
      return `${requirementText} 选 ${blockade.cost} 张手牌弃掉即可移除这块连接地形（棋子留在原地），之后再走到对面。`;
    }
    const mover = this.state!.turn?.activeMover;
    if (mover) {
      const dest = this.blockadeDestination(blockade, mover.symbol, mover.remaining);
      return dest
        ? `${requirementText} 当前移动力足够，点击会移除这块连接地形（棋子留在原地），之后再走到对面。`
        : `${requirementText} 当前正在使用的移动力不足以移除这里的连接地形。`;
    }

    if (this.selected.size > 0) {
      const seamSym = blockadeMoveSymbol(blockade);
      const hand = this.me?.hand ?? [];
      const candidates = [...this.selected]
        .filter((id) => hand.some((h) => h.id === id))
        .map((id) => ({ id, defId: cardDefId(id, this.state!) }));
      const pick = pickHandMover(seamSym, blockade.cost, candidates);
      return pick
        ? `${requirementText} 已选可用移动牌，点击这块地形会打出对应资源并移除障碍（棋子留在原地），之后再走到对面。`
        : `${requirementText} 已选 ${this.selected.size} 张手牌，但没有满足这块连接地形要求的移动牌。`;
    }

    return `${requirementText} 选择匹配的移动牌后，可以点击这块连接地形移除障碍（棋子留在原地），之后再走到对面。`;
  }

  private terrainActionStatus(hex: Hex): string {
    if (!this.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    const me = this.me;
    if (!me) return '没有找到你的棋子。';
    if (this.mode === 'clear') return '你正在清除地形，点击手牌支付费用。点击地形只会固定说明。';
    if (this.mode === 'remove') return '正在处理行动牌摸牌后的移除选择，完成后才能继续执行地形行动。';
    if (this.nativeActionCardId) {
      return this.canUseNativeOn(hex)
        ? '原住民向导可以无视此格地形需求，点击即可移动到这里。'
        : '原住民向导只能移动到可到达、未被其他玩家占用的相邻格；未移除的连接地形仍会阻挡。';
    }
    if (hex.terrain === 'mountain') return '山地不可进入，只能绕行。';
    if (!isAdjacent(me.position, hex)) return '此格不与当前棋子相邻，暂时不能行动。';
    const current = this.hexAt(me.position);
    if (hex.terrain === 'eldorado' && !isFinishEntrance(current)) return '必须先进入相邻的黄金城入口，才能进入黄金城。';
    if (hex.occupant && hex.occupant !== me.id) return '此格已有其他玩家，当前不能进入。';
    if (this.canStepToEldorado(hex)) return '点击即可进入黄金城，无需出牌。';
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') {
      const selected = this.selectedHandCardIds().length;
      const effect = hex.terrain === 'basecamp' ? '永久移出游戏' : '弃掉';
      if (selected === hex.cost) return `已选择 ${selected} 张手牌，点击此格会清除并进入；这些牌会${effect}。`;
      if (selected > 0) return `需要正好选择 ${hex.cost} 张手牌；当前选择了 ${selected} 张。`;
      return `先选择 ${hex.cost} 张手牌，再点击此格清除并进入；这些牌会${effect}。`;
    }

    const requirement = this.movementRequirement(hex);
    const requirementText = requirement.blockade && requirement.discard
      ? `边界碎石路障需要弃 ${requirement.cost} 张手牌；成功通过后会收入你的玩家信息。`
      : requirement.blockade && requirement.required
      ? `跨越边界阻挡物并进入对岸地形共需 ${SYMBOL_GLYPH[requirement.required]}${SYMBOL_LABEL[requirement.required]} ${requirement.cost} 点（阻挡物 + 目的地地形，须同一种符号）；成功通过后阻挡物会收入你的玩家信息。`
      : `此格需要 ${terrainCostText(hex)}。`;
    const mover = this.state!.turn?.activeMover;
    if (mover) {
      return this.canEnter(hex, mover.symbol, mover.remaining)
        ? `${requirementText} 当前移动力可以进入，进入后剩余 ${Math.max(0, mover.remaining - requirement.cost)} 点。`
        : `${requirementText} 当前正在使用的移动力不能进入此处。`;
    }

    if (this.selected.size > 0) {
      return `${requirementText} 已选 ${this.selected.size} 张手牌，点击此格会自动挑最省的一张打出并移动。`;
    }

    return `${requirementText} 选择匹配的移动牌后，点击相邻格即可移动。`;
  }
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
  if (!symbol) return `${SYMBOL_GLYPH.discard} 弃 ${blockade.cost} 张手牌`;
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

/** Generated card-back artwork for the deck/discard piles. */
function cardBack(): string {
  return '<img src="/cards/card-back.jpg" alt="卡背" draggable="false" />';
}

function el(tag: string, className = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (className) e.className = className;
  return e;
}

function button(label: string, onClick: () => void, secondary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (secondary) b.className = 'secondary';
  b.onclick = onClick;
  return b;
}

function colorHex(c: string): string {
  return { red: '#e05656', blue: '#4c9bef', green: '#5ed17a', yellow: '#f0d24c' }[c] ?? '#aaa';
}

function playerDisplayName(p: { name: string; isAI?: boolean }): string {
  if (!p.isAI) return p.name;
  const aiName = p.name.match(/^AI\s*(\d+)$/i);
  return aiName ? `电脑 ${aiName[1]}` : p.name;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

async function preloadBootAssets(): Promise<void> {
  const unique = [...new Set(BOOT_ASSET_URLS)];
  const total = unique.length;
  setBootProgress(3, '准备资源');
  let done = 0;
  await Promise.all(
    unique.map((url) =>
      preloadImage(url)
        .catch(() => undefined)
        .finally(() => {
          done += 1;
          setBootProgress(5 + Math.round((done / total) * 90), done < total ? '装载图像' : '整理界面');
        }),
    ),
  );
}

function preloadImage(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });
}

function setBootProgress(value: number, text: string): void {
  const pct = Math.max(0, Math.min(100, value));
  const bar = document.getElementById('bootbar') as HTMLSpanElement | null;
  const label = document.getElementById('bootpct');
  const copy = document.getElementById('boottext');
  if (bar) bar.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
  if (copy) copy.textContent = text;
}

function hideBootloader(): void {
  setBootProgress(100, '准备完成');
  const boot = document.getElementById('bootloader');
  if (!boot) return;
  boot.classList.add('done');
  setTimeout(() => boot.remove(), 420);
}

async function start(): Promise<void> {
  await preloadBootAssets();
  new App();
  requestAnimationFrame(() => hideBootloader());
}

void start();
