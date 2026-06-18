import './style.css';
import { Net } from './net.js';
import { Board } from './board.js';
import { cardFace } from './cardFaces.js';
import {
  getDef,
  movableSymbols,
  coinValue,
  neighbors,
  isAdjacent,
  distance,
  type GameState,
  type RoomView,
  type ServerMessage,
  type Hex,
  type Axial,
  type MoveSymbol,
  type Terrain,
  type Action,
} from '@eldorado/core';

const SYMBOL_GLYPH: Record<string, string> = {
  machete: '🗡️',
  paddle: '🛶',
  coin: '🪙',
};
const KIND_GLYPH: Record<string, string> = {
  green: '🗡️',
  blue: '🛶',
  yellow: '🪙',
  joker: '🃏',
  action: '✨',
};

function terrainSymbol(t: Terrain): MoveSymbol | null {
  if (t === 'green') return 'machete';
  if (t === 'blue') return 'paddle';
  if (t === 'yellow') return 'coin';
  return null;
}

/** Symbol a hex demands to enter (the El Dorado gate may require coin). */
function requiredFor(hex: Hex): MoveSymbol | null {
  if (hex.terrain === 'finish') return hex.reqSymbol ?? null;
  return terrainSymbol(hex.terrain);
}

/** Power a single step onto this hex costs. */
function stepCost(hex: Hex): number {
  if (hex.terrain === 'start') return 1;
  if (hex.terrain === 'finish') return Math.max(hex.cost, 1);
  return hex.cost;
}

type Mode = 'idle' | 'buy' | 'clear';

class App {
  net = new Net();
  board: Board;
  you: string | null = null;
  room: RoomView | null = null;
  state: GameState | null = null;

  // interaction
  selectedCardId: string | null = null;
  mode: Mode = 'idle';
  buyTargetDefId: string | null = null;
  payment = new Set<string>();
  clearTarget: Axial | null = null;
  hint = '';
  error = '';
  /** Which panel is open as a bottom sheet on mobile (null = none). */
  mobilePanel: 'players' | 'market' | null = null;
  nameValue = localStorage.getItem('eldorado.name') ?? '';

  private hud = document.getElementById('hud') as HTMLDivElement;
  private lobby = document.getElementById('lobby') as HTMLDivElement;
  private preview = el('div', 'card-preview');
  private handEls = new Map<string, HTMLElement>();
  private shopEls = new Map<string, HTMLElement>();
  private playerCardEls = new Map<string, HTMLElement>();
  private drawPileEl: HTMLElement | null = null;
  private discardPileEl: HTMLElement | null = null;

  constructor() {
    document.body.appendChild(this.preview);
    this.board = new Board(document.getElementById('board') as HTMLCanvasElement);
    (window as unknown as { __board: Board }).__board = this.board;
    this.board.onHexClick = (c) => this.onHexClick(c);
    this.net.onMessage = (m) => this.onMessage(m);
    this.net.connect();
    this.renderLobby();

    const saved = sessionStorage.getItem('eldorado.session');
    if (saved) {
      const { code, playerId } = JSON.parse(saved);
      this.net.send({ type: 'rejoin', code, playerId });
    }
  }

  // --- networking ---

  private onMessage(m: ServerMessage): void {
    switch (m.type) {
      case 'joined':
        this.you = m.playerId;
        sessionStorage.setItem('eldorado.session', JSON.stringify({ code: m.code, playerId: m.playerId }));
        break;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'lobby') this.renderLobby();
        break;
      case 'state': {
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
        this.state = m.state;
        this.resetSelection();
        this.lobby.classList.add('hidden');
        this.board.render(m.state);
        this.renderHud();
        this.recomputeHighlights();
        for (const e of buys) this.animateBuy(e.playerId, e.defId, sources.get(`${e.defId}|${e.playerId}`));
        break;
      }
      case 'error':
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
  private hexAt(c: Axial): Hex | undefined {
    return this.state?.hexes.find((h) => h.q === c.q && h.r === c.r);
  }

  private resetSelection(): void {
    this.selectedCardId = null;
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.payment.clear();
    this.clearTarget = null;
    this.hint = '';
  }

  /** Can a mover (symbol/power) enter this hex right now? */
  private canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean {
    const me = this.me;
    if (!me || !isAdjacent(me.position, hex)) return false;
    if (hex.terrain === 'mountain') return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') return false;
    const req = requiredFor(hex);
    if (req !== null && req !== symbol) return false;
    return power >= stepCost(hex);
  }

  private recomputeHighlights(): void {
    if (!this.isMyTurn() || !this.me) {
      this.board.setHighlights([]);
      return;
    }
    const me = this.me;
    const adj = neighbors(me.position)
      .map((c) => this.hexAt(c))
      .filter((h): h is Hex => !!h);
    const out: Axial[] = [];
    const mover = this.state!.turn?.activeMover;

    if (this.mode === 'clear' || this.mode === 'buy') {
      // selection happens in the hand panel; no hex highlight
    } else if (mover) {
      for (const h of adj) if (this.canEnter(h, mover.symbol, mover.remaining)) out.push(h);
    } else if (this.selectedCardId) {
      const def = getDef(cardDefId(this.selectedCardId, this.state!));
      const syms = movableSymbols(def.defId);
      for (const h of adj) {
        if (syms.some((s) => this.canEnter(h, s, def.power))) out.push(h);
      }
    }
    // clearable neighbors are always actionable on your turn
    for (const h of adj) {
      if ((h.terrain === 'rubble' || h.terrain === 'basecamp') && !h.occupant) out.push(h);
    }
    this.board.setHighlights(out);
  }

  // --- input ---

  private onHexClick(c: Axial): void {
    if (!this.isMyTurn()) return;
    const hex = this.hexAt(c);
    const me = this.me;
    if (!hex || !me || !isAdjacent(me.position, hex)) return;

    // 1) Clearable terrain → enter clear mode.
    if ((hex.terrain === 'rubble' || hex.terrain === 'basecamp') && !hex.occupant) {
      this.mode = 'clear';
      this.clearTarget = c;
      this.selectedCardId = null;
      this.payment.clear();
      this.hint = `选 ${hex.cost} 张牌${hex.terrain === 'basecamp' ? '（将被永久移除）' : ''}清除此格`;
      this.renderHud();
      this.recomputeHighlights();
      return;
    }

    const mover = this.state!.turn?.activeMover;
    // 2) Continue with the active mover.
    if (mover && this.canEnter(hex, mover.symbol, mover.remaining)) {
      this.act({ type: 'StepTo', to: c });
      return;
    }
    // 3) Play the selected card to move.
    if (this.selectedCardId) {
      const def = getDef(cardDefId(this.selectedCardId, this.state!));
      const req = requiredFor(hex);
      const syms = movableSymbols(def.defId);
      const sym: MoveSymbol | undefined = req && syms.includes(req) ? req : syms[0];
      if (sym && this.canEnter(hex, sym, def.power)) {
        const cardId = this.selectedCardId;
        this.selectedCardId = null;
        this.act({ type: 'PlayMovementCard', cardId, symbol: sym });
        this.act({ type: 'StepTo', to: c });
        return;
      }
    }
  }

  private onCardClick(cardId: string): void {
    if (!this.isMyTurn()) return;
    if (this.mode === 'buy') {
      if (this.payment.has(cardId)) this.payment.delete(cardId);
      else this.payment.add(cardId);
      this.renderHud();
      return;
    }
    if (this.mode === 'clear' && this.clearTarget) {
      if (this.payment.has(cardId)) this.payment.delete(cardId);
      else this.payment.add(cardId);
      const cost = this.hexAt(this.clearTarget)?.cost ?? 0;
      if (this.payment.size === cost) {
        this.act({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.payment] });
        return;
      }
      this.renderHud();
      return;
    }
    // movement selection
    const def = getDef(cardDefId(cardId, this.state!));
    if (def.kind === 'action') return; // actions not wired into the MVP UI yet
    this.selectedCardId = this.selectedCardId === cardId ? null : cardId;
    this.recomputeHighlights();
    this.renderHud();
  }

  private onMarketClick(defId: string): void {
    if (!this.isMyTurn() || this.state!.turn?.hasBought) return;
    this.mode = this.buyTargetDefId === defId ? 'idle' : 'buy';
    this.buyTargetDefId = this.mode === 'buy' ? defId : null;
    this.selectedCardId = null;
    this.payment.clear();
    this.hint = this.mode === 'buy' ? '选手牌支付，然后点「确认购买」' : '';
    // On mobile, close the market sheet so the hand is reachable for payment.
    if (this.mode === 'buy') this.mobilePanel = null;
    this.renderHud();
    this.recomputeHighlights();
  }

  private confirmBuy(): void {
    if (!this.buyTargetDefId) return;
    this.act({ type: 'BuyCard', defId: this.buyTargetDefId, paymentCardIds: [...this.payment] });
  }

  private cancelMode(): void {
    this.resetSelection();
    this.renderHud();
    this.recomputeHighlights();
  }

  private closeMobilePanel(): void {
    this.mobilePanel = null;
    this.renderHud();
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
    const toEl = playerId === this.you ? this.discardPileEl : this.playerCardEls.get(playerId);
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
    return !!this.selectedCardId || !!this.buyTargetDefId;
  }

  private attachPreview(node: HTMLElement, defId: string): void {
    node.addEventListener('mouseenter', () => this.showPreview(node, defId));
    node.addEventListener('mouseleave', () => {
      if (this.isPinned()) this.refreshPinnedPreview();
      else this.hidePreview();
    });
  }

  /** Show the preview for the currently-selected card, anchored to its element. */
  private refreshPinnedPreview(): void {
    if (this.selectedCardId && this.state) {
      const node = this.handEls.get(this.selectedCardId);
      if (node) return this.showPreview(node, cardDefId(this.selectedCardId, this.state));
    }
    if (this.buyTargetDefId) {
      const node = this.shopEls.get(this.buyTargetDefId);
      if (node) return this.showPreview(node, this.buyTargetDefId);
    }
    this.hidePreview();
  }

  private showPreview(anchor: HTMLElement, defId: string): void {
    this.preview.innerHTML = previewHtml(defId);
    this.preview.style.display = 'block';
    const pr = this.preview.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    let x: number;
    let y: number;
    if (anchor.closest('.hand-tray')) {
      // hand cards: dock to the left edge so the board stays unobscured
      x = 14;
      y = window.innerHeight / 2 - pr.height / 2;
    } else if (ar.left > window.innerWidth / 2) {
      // right-side market: float to the left of the card
      x = ar.left - pr.width - 14;
      y = ar.top + ar.height / 2 - pr.height / 2;
    } else {
      x = ar.left + ar.width / 2 - pr.width / 2;
      y = ar.top - pr.height - 14;
    }
    x = Math.max(10, Math.min(x, window.innerWidth - pr.width - 10));
    y = Math.max(10, Math.min(y, window.innerHeight - pr.height - 10));
    this.preview.style.left = `${x}px`;
    this.preview.style.top = `${y}px`;
  }

  private hidePreview(): void {
    this.preview.style.display = 'none';
  }

  // --- rendering: lobby ---

  private renderLobby(): void {
    const inLobby = !this.state || this.state.phase !== 'playing';
    this.lobby.classList.toggle('hidden', !inLobby && !!this.state);
    if (this.room && this.room.phase !== 'lobby') {
      this.lobby.classList.add('hidden');
      return;
    }

    const isHost = this.room?.hostId === this.you;
    this.lobby.innerHTML = '';
    const modal = el('div', 'modal');

    if (!this.room) {
      modal.innerHTML = `
        <h1>冲向黄金城</h1>
        <p class="sub">The Quest for El Dorado · 联机版</p>
        <label>你的名字</label>
        <input id="name" value="${escapeHtml(this.nameValue)}" placeholder="玩家名" />
        <label>房间码（加入已有房间）</label>
        <input id="code" placeholder="如 ABCD" maxlength="4" style="text-transform:uppercase" />
        <div class="row">
          <button id="create">创建房间</button>
          <button id="join" class="secondary">加入房间</button>
        </div>
        <div class="error">${escapeHtml(this.error)}</div>`;
      modal.querySelector<HTMLInputElement>('#name')!.oninput = (e) => {
        this.nameValue = (e.target as HTMLInputElement).value;
        localStorage.setItem('eldorado.name', this.nameValue);
      };
      modal.querySelector<HTMLButtonElement>('#create')!.onclick = () =>
        this.net.send({ type: 'createRoom', name: this.nameValue || '玩家' });
      modal.querySelector<HTMLButtonElement>('#join')!.onclick = () => {
        const code = modal.querySelector<HTMLInputElement>('#code')!.value.trim().toUpperCase();
        if (code) this.net.send({ type: 'joinRoom', code, name: this.nameValue || '玩家' });
      };
    } else {
      const players = this.room.players
        .map(
          (p) =>
            `<div class="player-chip"><span class="dot" style="background:${colorHex(p.color)}"></span>${escapeHtml(
              p.name,
            )}${p.isAI ? ' 🤖' : ''}${p.id === this.room!.hostId ? ' 👑' : ''}</div>`,
        )
        .join('');
      modal.innerHTML = `
        <h1>房间 <span style="color:#ffd166;letter-spacing:3px">${this.room.code}</span></h1>
        <p class="sub">把房间码发给朋友，或加入 AI 凑人数（2–4 人）</p>
        <div class="lobby-players">${players}</div>
        <div class="row">
          ${isHost ? '<button id="ai" class="secondary">+ 添加 AI</button>' : ''}
          ${isHost ? `<button id="start" ${this.room.players.length < 2 ? 'disabled' : ''}>开始游戏</button>` : '<div class="sub">等待房主开始…</div>'}
        </div>
        <div class="error">${escapeHtml(this.error)}</div>`;
      if (isHost) {
        modal.querySelector<HTMLButtonElement>('#ai')!.onclick = () => this.net.send({ type: 'addAI' });
        const startBtn = modal.querySelector<HTMLButtonElement>('#start');
        if (startBtn) startBtn.onclick = () => this.net.send({ type: 'startGame' });
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
    const finishes = s.hexes.filter((h) => h.terrain === 'finish');
    const starts = s.hexes.filter((h) => h.terrain === 'start');
    if (!finishes.length) return 0;
    const toFinish = (pos: Axial) => Math.min(...finishes.map((f) => distance(pos, f)));
    const ref = starts.length ? Math.max(...starts.map((st) => toFinish(st))) : 1;
    return Math.max(0, Math.min(1, 1 - toFinish(p.position) / Math.max(ref, 1)));
  }

  private renderHud(): void {
    this.hidePreview();
    if (!this.state || this.state.phase === 'lobby') {
      this.hud.innerHTML = '';
      return;
    }
    const s = this.state;
    const myTurn = this.isMyTurn();
    const turnName = s.players.find((p) => p.id === s.turn?.playerId)?.name ?? '';
    const winnerName = s.winnerId ? s.players.find((p) => p.id === s.winnerId)?.name : null;
    this.hud.innerHTML = '';
    this.handEls.clear();
    this.shopEls.clear();

    // --- top bar ---
    const top = el('div', 'topbar panel');
    let banner = `<div class="turn-banner">⏳ 等待 ${escapeHtml(turnName)}</div>`;
    if (s.phase === 'finished') banner = `<div class="turn-banner win">🏆 ${escapeHtml(winnerName ?? '')} 抵达黄金城！</div>`;
    else if (myTurn) banner = `<div class="turn-banner you">🟢 轮到你行动</div>`;
    top.innerHTML = `
      <div class="brand"><span class="logo">🏆</span><span>冲向黄金城</span><span class="code">${escapeHtml(this.room?.code ?? '')}</span></div>
      ${banner}
      <div class="hint-inline">滚轮缩放 · 拖拽平移 · 右键转视角</div>`;
    this.hud.appendChild(top);

    // --- mobile toolbar (market sheet toggle) ---
    const toolbar = el('div', 'mobile-toolbar');
    const mbtn = button('🛒 市场', () => {
      this.mobilePanel = this.mobilePanel === 'market' ? null : 'market';
      this.renderHud();
    });
    if (this.mobilePanel === 'market') mbtn.classList.add('active');
    toolbar.appendChild(mbtn);
    this.hud.appendChild(toolbar);

    // --- top-centre: players as cards ---
    this.playerCardEls.clear();
    const pcards = el('div', 'player-cards');
    for (const p of s.players) {
      const active = p.id === s.turn?.playerId;
      const card = el('div', `pcard ${active ? 'active' : ''} ${p.finished ? 'finished' : ''}`);
      card.style.setProperty('--pc', colorHex(p.color));
      const tags = `${p.isAI ? '<span class="ptag">AI</span>' : ''}${p.id === this.you ? '<span class="ptag you">你</span>' : ''}`;
      card.innerHTML = `
        <div class="pc-top">
          <span class="pc-dot"></span>
          <span class="pc-name">${escapeHtml(p.name)}</span>
          ${tags}
          <span class="pc-flag">${p.finished ? '🏆' : active ? '▶' : ''}</span>
        </div>
        <div class="pc-counts"><span>🂠 ${p.deck.length + p.hand.length}</span><span>♻ ${p.discard.length}</span></div>
        <div class="pc-progress"><span style="width:${Math.round(this.progressOf(p) * 100)}%"></span></div>`;
      pcards.appendChild(card);
      this.playerCardEls.set(p.id, card);
    }
    this.hud.appendChild(pcards);

    // --- right: market (all 18 cards; on-board buyable, others upcoming) ---
    const market = el('div', `market-panel panel ${this.mobilePanel === 'market' ? 'open' : ''}`);
    const onBoard = s.market.filter((m) => m.onBoard);
    const upcoming = s.market.filter((m) => !m.onBoard);
    const shopCard = (pile: (typeof s.market)[number], locked: boolean): HTMLDivElement => {
      const def = getDef(pile.defId);
      const sub = def.kind === 'action' ? '行动牌' : def.power ? `力量 ${def.power}` : '';
      const cls = locked ? 'upcoming' : pile.count === 0 ? 'sold' : '';
      const card = el('div', `shop-card ${this.buyTargetDefId === pile.defId ? 'target' : ''} ${cls}`);
      card.innerHTML = `
        <span class="ic card-thumb">${cardFace(def)}</span>
        <span class="nm">${escapeHtml(def.name)}<small>${sub}${def.singleUse ? ' · 单次' : ''}</small></span>
        <span class="price"><span class="c">${def.cost}💰</span><span class="left">${locked ? '待补充' : `×${pile.count}`}</span></span>`;
      if (!locked && pile.count > 0 && myTurn) card.onclick = () => this.onMarketClick(pile.defId);
      this.attachPreview(card, pile.defId);
      this.shopEls.set(pile.defId, card);
      return card;
    };
    market.innerHTML = '<h3>市场 · 在售</h3>';
    for (const pile of onBoard) market.appendChild(shopCard(pile, false));
    if (upcoming.length) {
      const sub = el('h3', '');
      sub.textContent = `待补充 · ${upcoming.length}`;
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

    // (draw/discard piles are built into the bottom dock, flanking the hand)

    // --- bottom dock: hand + actions ---
    const dock = el('div', 'dock');
    const me = this.me;
    const tray = el('div', 'hand-tray');
    if (me) {
      for (const c of me.hand) {
        const def = getDef(c.defId);
        const selected = this.selectedCardId === c.id;
        const inPayment = (this.mode === 'buy' || this.mode === 'clear') && this.payment.has(c.id);
        const card = el('div', `card ${def.kind} ${selected ? 'selected' : ''} ${inPayment ? 'payment' : ''}`);
        card.innerHTML = `
          ${cardFace(def)}`;
        if (myTurn) card.onclick = () => this.onCardClick(c.id);
        this.attachPreview(card, c.defId);
        this.handEls.set(c.id, card);
        tray.appendChild(card);
      }
    }

    const bar = el('div', 'action-bar');
    const ctx = el('div', 'ctx');
    ctx.textContent = myTurn ? this.hint : `等待 ${turnName} 行动…`;
    bar.appendChild(ctx);
    if (myTurn && s.phase === 'playing') {
      if (this.mode === 'buy') {
        const cost = this.buyTargetDefId ? getDef(this.buyTargetDefId).cost : 0;
        const have = [...this.payment].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
        const buy = button(`确认购买 (${have}/${cost}💰)`, () => this.confirmBuy(), false);
        buy.className = 'gold';
        buy.disabled = have < cost;
        bar.appendChild(buy);
        bar.appendChild(button('取消', () => this.cancelMode(), true));
      } else if (this.mode === 'clear') {
        bar.appendChild(button('取消', () => this.cancelMode(), true));
      } else {
        bar.appendChild(button('结束回合', () => this.act({ type: 'EndTurn' }), true));
      }
    }
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
  }
}

// --- small DOM helpers ---

function cardDefId(cardId: string, state: GameState): string {
  for (const p of state.players) {
    const c = [...p.hand, ...p.deck, ...p.discard].find((x) => x.id === cardId);
    if (c) return c.defId;
  }
  // ids look like "playerId:defId#n"
  const m = cardId.match(/:([a-z_]+)#/);
  return m ? m[1] : cardId;
}

const KIND_LABEL: Record<string, string> = {
  green: '丛林 · 砍刀',
  blue: '水域 · 船桨',
  yellow: '村庄 · 金币',
  joker: '万能牌',
  action: '行动牌',
};

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
        return '将棋子移动到相邻 1 格，无视该格地形需求（可直接拆除路障）。';
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

/** Original procedural card-back art for the deck/discard piles. */
function cardBack(): string {
  return `<svg viewBox="0 0 60 84" width="100%" height="100%" preserveAspectRatio="none">
    <defs><linearGradient id="cb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#21386180"/><stop offset="0" stop-color="#213861"/>
      <stop offset="1" stop-color="#0d1a33"/></linearGradient></defs>
    <rect x="1.5" y="1.5" width="57" height="81" rx="7" fill="url(#cb)" stroke="#c8a24c" stroke-width="1.5"/>
    <rect x="5" y="5" width="50" height="74" rx="4.5" fill="none" stroke="#c8a24c" stroke-opacity="0.45"/>
    <g transform="translate(30 42)">
      <circle r="13" fill="none" stroke="#e7c264" stroke-opacity="0.45" stroke-width="1.2"/>
      <path d="M0 -15 L3.4 -3.4 15 0 3.4 3.4 0 15 -3.4 3.4 -15 0 -3.4 -3.4 Z" fill="#e7c264" fill-opacity="0.9"/>
      <circle r="3" fill="#0d1a33" stroke="#e7c264" stroke-width="1.1"/>
    </g>
    <g fill="#c8a24c" fill-opacity="0.7">
      <circle cx="10" cy="10" r="1.4"/><circle cx="50" cy="10" r="1.4"/>
      <circle cx="10" cy="74" r="1.4"/><circle cx="50" cy="74" r="1.4"/>
    </g>
  </svg>`;
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

new App();
