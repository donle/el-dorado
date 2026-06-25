/**
 * controllers/BoardCoordinator — owns the in-game view's higher-level
 * orchestration: enter-game transitions, turn-intro overlays, and the
 * buy-animation fly-from-market path.
 *
 * Extracted from the App god class so the small set of methods that
 * bridge server-driven events to multi-component visual changes
 * (board + hover panel + HUD re-render + DOM clone animation) live in
 * one place. The pile DOM helpers (makePile) move here too because
 * they feed directly into the buy animation.
 *
 * The coordinator is intentionally thin: it just sequences calls into
 * the Board scene, the HoverStateMachine, and the DOM, all read via
 * the host interface.
 */
import {
  type GameEvent,
  type GameState,
  type Player,
  type RoomView,
} from '@eldorado/core';
import { getDef } from '@eldorado/core';
import { cardFace } from '../cardFaces.js';
import { cardBack, el } from '../views/common/dom.js';
import {
  clearTurnIntro as clearTurnIntroOverlay,
  showTurnIntro as showTurnIntroOverlay,
} from '../views/overlays/TurnIntroOverlay.js';

type BoardLike = {
  setSelfPlayerId(id: string | null): void;
  render(state: GameState): void;
};

type HoverMachineLike = {
  renderTerrainPanel(): void;
};

export interface BoardCoordinatorHost {
  // Game state
  readonly state: GameState | null;
  readonly you: string | null;
  readonly me: Player | null;
  readonly room: RoomView | null;

  // Subsystems
  readonly board: BoardLike;
  readonly hoverMachine: HoverMachineLike;

  // Render entry points
  renderHud(): void;
  recomputeHighlights(): void;

  // DOM refs the coordinator needs for the buy animation.
  // App writes them during renderHud; the coordinator reads them
  // when running flyCard.
  readonly handEls: Map<string, HTMLElement>;
  readonly shopEls: Map<string, HTMLElement>;
  readonly playerCardEls: Map<string, HTMLElement>;
  readonly drawPileEl: HTMLElement | null;
  readonly discardPileEl: HTMLElement | null;
}

export class BoardCoordinator {
  constructor(private readonly host: BoardCoordinatorHost) {}

  // --- enter / leave game -------------------------------------------

  enterGameView(): void {
    const state = this.host.state;
    if (!state || state.phase === 'lobby') return;
    this.host.board.setSelfPlayerId(this.host.you);
    this.host.board.render(state);
    this.host.renderHud();
    this.host.recomputeHighlights();
    this.host.hoverMachine.renderTerrainPanel();
  }

  // --- turn intro overlay -------------------------------------------

  shouldShowTurnIntro(previousState: GameState | null, nextState: GameState, events: GameEvent[]): boolean {
    if (!this.host.you || nextState.phase !== 'playing' || nextState.turn?.playerId !== this.host.you) return false;
    if (previousState?.turn?.playerId === this.host.you) return false;
    if (previousState) return true;
    return events.some((e) => e.type === 'turnStarted' && e.playerId === this.host.you);
  }

  showTurnIntro(): void {
    showTurnIntroOverlay();
  }

  clearTurnIntro(): void {
    clearTurnIntroOverlay();
  }

  // --- piles ---------------------------------------------------------

  makePile(kind: 'draw' | 'discard', label: string, count: number): HTMLElement {
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

  // --- buy animation -------------------------------------------------

  /**
   * Fly a card-shaped clone of the bought card from the market to its
   * destination (the buyer's hand, discard pile, or player card).
   */
  flyCard(defId: string, from: DOMRect, to: DOMRect, fade: boolean): void {
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

  animateBuy(playerId: string, defId: string, source?: DOMRect): void {
    const me = this.host.me;
    const you = this.host.you;
    const immediateHandEl = defId === 'cartographer'
      ? [...(me?.hand ?? [])].reverse().find((c) => c.defId === defId)
      : undefined;
    const toEl = playerId === you
      ? (immediateHandEl ? this.host.handEls.get(immediateHandEl.id) : this.host.discardPileEl)
      : this.host.playerCardEls.get(playerId);
    if (!toEl) return;
    let from = source;
    const offscreen =
      !from || from.width === 0 || from.bottom < 0 || from.top > window.innerHeight || from.left > window.innerWidth;
    if (offscreen) {
      // market not visible (e.g. closed sheet) → fall back to the right edge
      from = new DOMRect(window.innerWidth - 56, window.innerHeight / 2 - 30, 40, 56);
    }
    this.flyCard(defId, from!, toEl.getBoundingClientRect(), playerId !== you);
  }
}
