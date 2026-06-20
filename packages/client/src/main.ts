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
  pickHandMover,
  type GameState,
  type RoomView,
  type ServerMessage,
  type Hex,
  type Axial,
  type MoveSymbol,
  type Terrain,
  type Action,
  type Blockade,
} from '@eldorado/core';

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

/** Symbol a hex demands to enter (the El Dorado gate may require coin). */
function requiredFor(hex: Hex): MoveSymbol | null {
  if (hex.terrain === 'finish') return hex.reqSymbol ?? null;
  return terrainSymbol(hex.terrain);
}

/** Power a single step onto this hex costs. */
function stepCost(hex: Hex): number {
  if (hex.terrain === 'start') return 1;
  if (hex.terrain === 'eldorado') return 1;
  if (hex.terrain === 'finish') return Math.max(hex.cost, 1);
  return hex.cost;
}

function sameCoord(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

type Mode = 'idle' | 'clear';

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
  clearTarget: Axial | null = null;
  clearBlockadeId: string | null = null;
  viewMode: '3d' | '2d' = localStorage.getItem('eldorado.viewMode') === '2d' ? '2d' : '3d';
  hint = '';
  error = '';
  /** Which panel is open as a bottom sheet on mobile (null = none). */
  mobilePanel: 'players' | 'market' | null = null;
  nameValue = localStorage.getItem('eldorado.name') ?? '';

  private hud = document.getElementById('hud') as HTMLDivElement;
  private lobby = document.getElementById('lobby') as HTMLDivElement;
  private preview = el('div', 'card-preview');
  private terrainPanel = el('div', 'terrain-panel panel hidden');
  private handEls = new Map<string, HTMLElement>();
  private shopEls = new Map<string, HTMLElement>();
  private playerCardEls = new Map<string, HTMLElement>();
  private drawPileEl: HTMLElement | null = null;
  private discardPileEl: HTMLElement | null = null;
  private hoveredTerrain: Axial | null = null;
  private pinnedTerrain: Axial | null = null;
  private hoveredBlockadeId: string | null = null;
  private pinnedBlockadeId: string | null = null;

  constructor() {
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
        this.syncSelectionToState();
        this.lobby.classList.add('hidden');
        this.board.setSelfPlayerId(this.you);
        this.board.render(m.state);
        this.renderHud();
        this.recomputeHighlights();
        this.renderTerrainPanel();
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

  private blockadeById(id: string | null): Blockade | undefined {
    return id ? this.state?.blockades.find((b) => b.id === id) : undefined;
  }

  private resetSelection(): void {
    this.selected.clear();
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.clearTarget = null;
    this.clearBlockadeId = null;
    this.hint = '';
  }

  /**
   * Reconcile selection when fresh server state arrives. Transient targets
   * (buy/clear/mode) always reset, but the hand selection is PRESERVED across
   * the player's own turn so a multi-card movement chain keeps walking without
   * re-selecting — each step's played card simply drops out of the hand and is
   * pruned here. Selection is cleared entirely when it isn't our turn.
   */
  private syncSelectionToState(): void {
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.clearTarget = null;
    this.clearBlockadeId = null;
    this.hint = '';
    if (!this.isMyTurn() || !this.me) {
      this.selected.clear();
      return;
    }
    const handIds = new Set(this.me.hand.map((c) => c.id));
    for (const id of [...this.selected]) if (!handIds.has(id)) this.selected.delete(id);
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

  private canUseBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade) && !!this.blockadeDestination(blockade, symbol, power);
  }

  private canClearBlockade(blockade: Blockade): boolean {
    return !blockade.claimedBy && blockadeRequiresDiscard(blockade) && !!this.blockadeDestination(blockade);
  }

  private canRemoveBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade)
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
    if (hex.terrain === 'eldorado' && current?.terrain !== 'finish') return false;
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

    if (this.mode === 'clear') {
      // selection happens in the hand panel; no hex highlight
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
    // clearable neighbors are always actionable on your turn
    for (const h of adj) {
      if ((h.terrain === 'rubble' || h.terrain === 'basecamp') && !h.occupant) out.push(h);
    }
    this.board.setHighlights(out);
    this.board.setBlockadeHighlights([...blockadeOut]);
  }

  // --- input ---

  private onHexHover(c: Axial | null): void {
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
    if (this.mode === 'clear') return false;
    const hex = this.hexAt(c);
    const me = this.me;
    if (!hex || !me || !isAdjacent(me.position, hex)) return false;

    const between = this.blockadeBetween(me.position, hex);
    if (between && !between.claimedBy) {
      this.flash('先点连接地形移除障碍');
      return true;
    }

    // 1) Clearable terrain → enter clear mode.
    if ((hex.terrain === 'rubble' || hex.terrain === 'basecamp') && !hex.occupant) {
      this.mode = 'clear';
      this.clearTarget = c;
      this.clearBlockadeId = null;
      this.selected.clear();
      this.hint = `选 ${hex.cost} 张牌${hex.terrain === 'basecamp' ? '（将被永久移除）' : ''}清除此格`;
      this.renderHud();
      this.recomputeHighlights();
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
    this.hoveredBlockadeId = id;
    if (id) this.hoveredTerrain = null;
    this.renderTerrainPanel();
    if (!id && !this.pinnedTerrain && !this.pinnedBlockadeId) this.refreshPinnedPreview();
  }

  private onBlockadeClick(id: string): void {
    if (this.tryActOnBlockade(id)) return;

    this.pinnedBlockadeId = id;
    this.pinnedTerrain = null;
    this.board.setInspectedBlockade(id);
    this.board.setInspectedHex(null);
    this.renderTerrainPanel();
  }

  private tryActOnBlockade(id: string): boolean {
    if (!this.isMyTurn()) return false;
    if (this.mode === 'clear') return false;
    const blockade = this.blockadeById(id);
    if (!blockade) return false;

    // Unclaimed: REMOVE in place (do not move).
    if (!blockade.claimedBy) {
      if (blockadeRequiresDiscard(blockade)) {
        // enter card-selection to discard exactly blockade.cost cards
        this.mode = 'clear';
        this.clearBlockadeId = blockade.id;
        this.clearTarget = null; // marker: removing a blockade, not a hex
        this.selected.clear();
        this.hint = `选 ${blockade.cost} 张牌弃掉，移除这块连接地形`;
        this.renderHud();
        this.recomputeHighlights();
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
        this.act({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
        this.act({ type: 'RemoveBlockade', blockadeId: blockade.id });
        return true;
      }
      this.flash('没有可用于移除这块连接地形的牌');
      return true;
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
    if (this.mode === 'clear') {
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else this.selected.add(cardId);
      const cost = this.clearBlockadeId
        ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
        : this.hexAt(this.clearTarget!)?.cost ?? 0;
      if (this.selected.size === cost) {
        if (this.clearBlockadeId) {
          this.act({ type: 'RemoveBlockade', blockadeId: this.clearBlockadeId, cardIds: [...this.selected] });
        } else if (this.clearTarget) {
          this.act({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.selected] });
        }
        return;
      }
      this.renderHud();
      return;
    }
    if (this.selected.has(cardId)) this.selected.delete(cardId);
    else this.selected.add(cardId);
    this.recomputeHighlights();
    this.renderHud();
  }

  private onMarketClick(defId: string): void {
    if (!this.isMyTurn()) return;
    if (this.state!.turn?.hasBought) { this.flash('本回合已购买 · 每回合限买 1 张'); return; }
    this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
    this.hint = this.buyTargetDefId ? '选手牌支付，然后点「确认购买」' : '';
    if (this.buyTargetDefId) this.mobilePanel = null;
    this.renderHud();
  }

  private confirmBuy(): void {
    if (!this.buyTargetDefId) return;
    this.act({ type: 'BuyCard', defId: this.buyTargetDefId, paymentCardIds: [...this.selected] });
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

  private toggleViewMode(): void {
    this.viewMode = this.viewMode === '3d' ? '2d' : '3d';
    localStorage.setItem('eldorado.viewMode', this.viewMode);
    this.board.setViewMode(this.viewMode);
    this.renderHud();
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
    return this.selected.size > 0 || !!this.buyTargetDefId;
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
    if (this.selected.size === 1 && this.state) {
      const id = [...this.selected][0];
      const node = this.handEls.get(id);
      if (node) return this.showPreview(node, cardDefId(id, this.state));
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
    // Dock every card preview (hand AND market) to the left edge, vertically
    // centered, so it never covers the board.
    let x = 14;
    let y = window.innerHeight / 2 - pr.height / 2;
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
    this.renderTerrainPanel();
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
        <p class="sub">桌游改编 · 联机版</p>
        <label>你的名字</label>
        <input id="name" value="${escapeHtml(this.nameValue)}" placeholder="玩家名" />
        <label>房间码（加入已有房间）</label>
        <input id="code" placeholder="请输入 4 位房间码" maxlength="4" style="text-transform:uppercase" />
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
              playerDisplayName(p),
            )}${p.isAI ? ' 🤖' : ''}${p.id === this.room!.hostId ? ' 👑' : ''}</div>`,
        )
        .join('');
      modal.innerHTML = `
        <h1>房间 <span style="color:#ffd166;letter-spacing:3px">${this.room.code}</span></h1>
        <p class="sub">把房间码发给朋友，或加入电脑玩家凑人数（2–4 人）</p>
        <div class="lobby-players">${players}</div>
        <div class="row">
          ${isHost ? '<button id="ai" class="secondary">+ 添加电脑</button>' : ''}
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
    const finishes = s.hexes.some((h) => h.terrain === 'eldorado')
      ? s.hexes.filter((h) => h.terrain === 'eldorado')
      : s.hexes.filter((h) => h.terrain === 'finish');
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
    const turnPlayer = s.players.find((p) => p.id === s.turn?.playerId);
    const winnerPlayer = s.winnerId ? s.players.find((p) => p.id === s.winnerId) : null;
    const turnName = turnPlayer ? playerDisplayName(turnPlayer) : '';
    const winnerName = winnerPlayer ? playerDisplayName(winnerPlayer) : null;
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
      <div class="hint-inline">${this.viewMode === '2d' ? '2D 俯视 · 拖拽平移 · 滚轮缩放' : '滚轮缩放 · 拖拽平移 · 右键转视角'}</div>`;
    const viewBtn = button(this.viewMode === '3d' ? '2D 视图' : '3D 视图', () => this.toggleViewMode(), true);
    viewBtn.className = `view-toggle ${this.viewMode === '2d' ? 'active' : ''}`;
    viewBtn.title = this.viewMode === '3d' ? '切换到锁定俯视 2D 视图' : '切换回可旋转 3D 视图';
    top.appendChild(viewBtn);
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
      const tags = `${p.isAI ? '<span class="ptag">电脑</span>' : ''}${p.id === this.you ? '<span class="ptag you">你</span>' : ''}`;
      card.innerHTML = `
        <div class="pc-top">
          <span class="pc-dot"></span>
          <span class="pc-name">${escapeHtml(playerDisplayName(p))}</span>
          ${tags}
          <span class="pc-flag">${p.finished ? '🏆' : active ? '▶' : ''}</span>
        </div>
        <div class="pc-counts"><span>牌库 ${p.deck.length + p.hand.length}</span><span>弃牌 ${p.discard.length}</span><span>阻挡物 ${p.blockades}</span></div>
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
    const bought = myTurn && !!s.turn?.hasBought;
    market.innerHTML = `<h3>市场 · ${bought ? '本回合已购买' : '在售'}</h3>`;
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
        const selected = this.selected.has(c.id);
        const card = el('div', `card ${def.kind} ${selected ? 'selected' : ''}`);
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
      if (this.mode === 'clear') {
        bar.appendChild(button('取消', () => this.cancelMode(), true));
      } else {
        if (this.buyTargetDefId) {
          const cost = getDef(this.buyTargetDefId).cost;
          const have = [...this.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
          const buy = button(`确认购买 (${have}/${cost}💰)`, () => this.confirmBuy(), false);
          buy.className = 'gold';
          buy.disabled = have < cost;
          bar.appendChild(buy);
        }
        bar.appendChild(button('结束回合', () => this.act({ type: 'EndTurn' }), true));
        const discarded = !!s.turn?.hasDiscarded;
        const skill = button(discarded ? '已弃牌' : '弃牌', () => {
          if (discarded || this.selected.size === 0) return;
          this.act({ type: 'DiscardCards', cardIds: [...this.selected] });
        }, true);
        skill.disabled = discarded || this.selected.size === 0;
        bar.appendChild(skill);
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
    this.renderTerrainPanel();
  }

  private closeTerrainPanel(): void {
    this.pinnedTerrain = null;
    this.hoveredTerrain = null;
    this.pinnedBlockadeId = null;
    this.hoveredBlockadeId = null;
    this.board.setInspectedHex(null);
    this.board.setInspectedBlockade(null);
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
      this.terrainPanel.classList.add('hidden');
      this.terrainPanel.innerHTML = '';
      if (!hex) this.board.setInspectedHex(null);
      if (!activeBlockade) this.board.setInspectedBlockade(null);
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
  }

  private blockadeActionStatus(blockade: Blockade): string {
    if (!this.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    if (this.mode === 'clear') return '你正在清除地形，点击手牌支付费用。点击连接地形只会固定说明。';
    if (blockade.claimedBy) return '这块连接地形已经被领取，不再作为可领取阻挡物。';
    if (!this.blockadeDestination(blockade)) return '当前棋子不在这块连接地形覆盖的边旁边，暂时不能行动。';

    const requirementText = `连接地形需要 ${blockadeCostText(blockade)}；第一个通过的玩家会领取它，玩家信息中的阻挡物数量会增加。`;
    if (blockadeRequiresDiscard(blockade)) {
      return `${requirementText} 点击这块地形会进入清除模式，选择 ${blockade.cost} 张手牌弃掉后通过。`;
    }
    const mover = this.state!.turn?.activeMover;
    if (mover) {
      const dest = this.blockadeDestination(blockade, mover.symbol, mover.remaining);
      return dest
        ? `${requirementText} 当前移动力可以通过，点击这块地形会跨到另一侧。`
        : `${requirementText} 当前正在使用的移动力不能通过这里。`;
    }

    if (this.selected.size > 0) {
      return `${requirementText} 已选 ${this.selected.size} 张手牌，点击这块地形会自动挑最省的一张打出并通过。`;
    }

    return `${requirementText} 选择匹配的移动牌后，可以点击这块连接地形通过。`;
  }

  private terrainActionStatus(hex: Hex): string {
    if (!this.isMyTurn()) return '当前不是你的回合，可以查看说明，但不能执行地形行动。';
    const me = this.me;
    if (!me) return '没有找到你的棋子。';
    if (this.mode === 'clear') return '你正在清除地形，点击手牌支付费用。点击地形只会固定说明。';
    if (hex.terrain === 'mountain') return '山地不可进入，只能绕行。';
    if (!isAdjacent(me.position, hex)) return '此格不与当前棋子相邻，暂时不能行动。';
    const current = this.hexAt(me.position);
    if (hex.terrain === 'eldorado' && current?.terrain !== 'finish') return '必须先进入相邻的黄金城入口，才能进入黄金城。';
    if (hex.occupant && hex.occupant !== me.id) return '此格已有其他玩家，当前不能进入。';
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') {
      return `点击可进入清除模式，需要选择 ${hex.cost} 张手牌${hex.terrain === 'basecamp' ? '并永久移出游戏' : '弃掉'}。`;
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
    rule: '山地不可进入，也不能被清除，只能绕行。',
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
    rule: '只能从相邻的黄金城入口进入，消耗 1 点任意移动力。进入后触发最终结算阶段。',
  },
};

function terrainInfo(hex: Hex): TerrainInfo {
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
  if (hex.terrain === 'mountain') return '不可进入';
  if (hex.terrain === 'eldorado') return '任意移动力 1 点';
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

new App();
