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
      case 'state':
        this.state = m.state;
        this.resetSelection();
        this.lobby.classList.add('hidden');
        this.board.render(m.state);
        this.renderHud();
        this.recomputeHighlights();
        break;
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
    if (ar.left > window.innerWidth / 2) {
      // right-side market: float to the left of the card
      x = ar.left - pr.width - 14;
      y = ar.top + ar.height / 2 - pr.height / 2;
    } else {
      // bottom hand: float above the card
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

    // --- mobile toolbar (toggles the bottom-sheet panels) ---
    const toolbar = el('div', 'mobile-toolbar');
    const toggle = (which: 'players' | 'market', label: string) => {
      const btn = button(label, () => {
        this.mobilePanel = this.mobilePanel === which ? null : which;
        this.renderHud();
      });
      if (this.mobilePanel === which) btn.classList.add('active');
      return btn;
    };
    toolbar.appendChild(toggle('players', '👥 队伍'));
    toolbar.appendChild(toggle('market', '🛒 市场'));
    this.hud.appendChild(toolbar);

    // --- left: players ---
    const pp = el('div', `players-panel panel ${this.mobilePanel === 'players' ? 'open' : ''}`);
    pp.innerHTML = '<h3>探险队</h3>';
    for (const p of s.players) {
      const active = p.id === s.turn?.playerId;
      const row = el('div', `player-row ${active ? 'active' : ''} ${p.finished ? 'finished' : ''}`);
      const tags = `${p.isAI ? '<span class="tag">AI</span>' : ''}${p.id === this.you ? '<span class="tag">你</span>' : ''}`;
      row.innerHTML = `
        <span class="dot" style="background:${colorHex(p.color)}"></span>
        <span class="pname">${escapeHtml(p.name)} ${tags}</span>
        <span class="tag">${p.finished ? '🏆' : active ? '▶' : ''}</span>
        <span class="counts">牌库 <b>${p.deck.length}</b> · 手 <b>${p.hand.length}</b> · 弃 <b>${p.discard.length}</b></span>
        <span class="progress"><span style="width:${Math.round(this.progressOf(p) * 100)}%"></span></span>`;
      pp.appendChild(row);
    }
    this.hud.appendChild(pp);

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
        const foot = def.kind === 'action' ? '行动' : `${coinValue(c.defId)}💰`;
        card.innerHTML = `
          ${cardFace(def)}
          <div class="card-value" title="${escapeHtml(foot)}">${escapeHtml(foot)}${def.singleUse ? ' · 单次' : ''}</div>`;
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
    dock.appendChild(tray);
    dock.appendChild(bar);
    this.hud.appendChild(dock);

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
