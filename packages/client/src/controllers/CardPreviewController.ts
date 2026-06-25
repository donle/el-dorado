/**
 * controllers/CardPreviewController — owns the card preview popover DOM
 * (`.card-preview`) and its positioning, pinning, and market-preview
 * actionability logic.
 *
 * Extracted from the App god class so the preview subsystem can evolve
 * (3 viewport branches + market-preview variant) independently. The
 * controller is consumed by:
 * - `HoverStateMachine` (refresh / hide)
 * - `ActionLogPanel` (attach + show on log card chip)
 * - `renderHud` (refresh after hand/market rebuild)
 * - `HandPanel` / `MarketPanel` / `MarketSlot` (via the `attachPreview`
 *   callback in their input envelope)
 *
 * Dependencies are injected through a `CardPreviewHost` so the class
 * is testable in isolation.
 */
import { cardDefId, getDef } from '@eldorado/core';
import type { GameState } from '@eldorado/core';
import { button, el } from '../views/common/dom.js';
import { previewHtml } from '../views/cards/CardDescription.js';
import type { MobileLayoutProbe } from './MobileLayoutProbe.js';

export interface CardPreviewHost {
  readonly state: GameState | null;
  readonly mobilePanel: 'players' | 'market' | 'log' | null;
  readonly interaction: CardPreviewInteraction;
  /** DOM maps the controller reads to find anchor elements. */
  readonly handEls: Map<string, HTMLElement>;
  readonly shopEls: Map<string, HTMLElement>;
  /** Mobile/orientation probe — used to branch preview positioning. */
  readonly mobileLayout: MobileLayoutProbe;
  /** True when at least one market card is on the board and the current
   *  player still needs to promote one to fill it. */
  marketNeedsPromotion(state: GameState): boolean;
}

/** Subset of InteractionController the preview controller reaches for. */
export interface CardPreviewInteraction {
  readonly selected: Set<string>;
  readonly buyTargetDefId: string | null;
  readonly promoteTargetDefId: string | null;
  readonly marketPreviewDefId: string | null;
  usesMarketPreviewFlow(): boolean;
  canSelectMarketPreview(defId: string): boolean;
  selectMarketPreviewCard(): void;
  isPinned(): boolean;
}

export class CardPreviewController {
  private readonly preview: HTMLElement;

  constructor(private readonly host: CardPreviewHost) {
    this.preview = el('div', 'card-preview inspector-popover panel hidden');
    document.body.appendChild(this.preview);
  }

  /** A card is "pinned" while it's selected — its preview stays open. */
  isPinned(): boolean {
    return this.host.interaction.isPinned();
  }

  /** Wrap a card chip with the standard hover/click preview behavior. */
  attachPreview(node: HTMLElement, defId: string): void {
    node.addEventListener('mouseenter', () => {
      if (this.host.interaction.usesMarketPreviewFlow()) return;
      this.showPreview(node, defId);
    });
    node.addEventListener('mouseleave', () => {
      if (this.host.interaction.usesMarketPreviewFlow()) return;
      if (this.isPinned()) this.refreshPinnedPreview();
      else this.hidePreview();
    });
  }

  /** Show the preview for the currently-selected card, anchored to its element. */
  refreshPinnedPreview(): void {
    const ix = this.host.interaction;
    if (ix.selected.size === 1 && this.host.state) {
      const id = [...ix.selected][0];
      const node = this.host.handEls.get(id);
      if (node) return this.showPreview(node, cardDefId(id, this.host.state));
    }
    if (ix.buyTargetDefId) {
      const node = this.host.shopEls.get(ix.buyTargetDefId);
      if (node) return this.showPreview(node, ix.buyTargetDefId);
    }
    if (ix.promoteTargetDefId) {
      const node = this.host.shopEls.get(ix.promoteTargetDefId);
      if (node) return this.showPreview(node, ix.promoteTargetDefId);
    }
    if (ix.marketPreviewDefId) {
      const node = this.host.shopEls.get(ix.marketPreviewDefId);
      if (node) return this.showPreview(node, ix.marketPreviewDefId);
    }
    this.hidePreview();
  }

  /** Force a preview popover to open on the given anchor. */
  showPreview(_anchor: HTMLElement, defId: string): void {
    const compactLandscape = this.host.mobileLayout.isCompactLandscape();
    const marketPreview = this.host.interaction.usesMarketPreviewFlow();

    this.preview.innerHTML = previewHtml(defId);
    this.preview.classList.toggle('from-log', this.host.mobilePanel === 'log');
    const actionableMarketPreview =
      marketPreview &&
      this.host.interaction.marketPreviewDefId === defId &&
      this.host.interaction.canSelectMarketPreview(defId);
    this.preview.classList.toggle('actionable', actionableMarketPreview);
    if (actionableMarketPreview) {
      const state = this.host.state;
      const pile = state?.market.find((m) => m.defId === defId);
      const promote =
        !!state &&
        !!pile &&
        !pile.onBoard &&
        this.host.marketNeedsPromotion(state) &&
        !state.turn?.hasBought;
      const def = getDef(defId);
      const label = promote ? `放入市场 · ${def.cost}💰` : `选为购买目标 · ${def.cost}💰`;
      const select = button(label, () => this.host.interaction.selectMarketPreviewCard(), false);
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

  hidePreview(): void {
    this.preview.classList.add('hidden');
    this.preview.classList.remove('actionable');
    this.preview.classList.remove('from-log');
  }
}