/**
 * A single market slot — the on-board buyable tile or the locked upcoming slot.
 *
 * Renders one market card thumb inside the right-side market panel. Pure
 * renderer: the owning panel wires click + preview handlers through the env.
 */
import { type CardDef, type MarketPile } from '@eldorado/core';
import { cardFace } from '../../cardFaces.js';
import { el, escapeHtml } from '../common/dom.js';

export interface MarketSlotState {
  pile: MarketPile;
  /** True when this pile is in the upcoming/locked area (not on the 6 buyable slots). */
  locked: boolean;
  /** Resolved card def for `pile.defId`. */
  def: CardDef;
  /** defId of the current buy/promote target (drives the .target class). */
  selectedDefId: string | null;
  /** defId of the inline preview (drives the .previewing class). */
  previewDefId: string | null;
  /** True when the local player may promote a locked pile into an on-board slot. */
  canPromote: boolean;
  /** True when it's currently the local player's turn. */
  myTurn: boolean;
  /** True when the mobile preview flow is in use (drives long-press handler). */
  usesMarketPreviewFlow: boolean;
  /** True when the active action card is Transmitter (take_free). */
  freeTakeAction: boolean;
  /** Mobile preview gate: true iff a tap on this slot should be a buy/promote click. */
  canSelectMarketPreview: boolean;
}

export interface MarketSlotEnv {
  onClick: (defId: string) => void;
  preview: (defId: string) => void;
  /** Forward `attachPreview` from the host App. */
  attachPreview: (node: HTMLElement, defId: string) => void;
}

/** Build a single market slot DOM element. */
export function renderMarketSlot(state: MarketSlotState, env: MarketSlotEnv): HTMLElement {
  const { pile, locked, def, selectedDefId, previewDefId, canPromote, myTurn, usesMarketPreviewFlow, freeTakeAction, canSelectMarketPreview } = state;
  const sub = def.kind === 'action' ? '行动牌' : def.power ? `力量 ${def.power}` : '';
  const cls = locked ? (canPromote ? 'promotable' : 'upcoming') : pile.count === 0 ? 'sold' : '';
  const left = locked ? (canPromote ? '补位' : '候补') : `×${pile.count}`;
  const card = el(
    'div',
    `shop-card ${selectedDefId === pile.defId ? 'target' : ''} ${previewDefId === pile.defId ? 'previewing' : ''} ${cls}`,
  );
  card.innerHTML = `
    <span class="ic card-thumb">${cardFace(def)}</span>
    <span class="nm">${escapeHtml(def.name)}<small>${sub}${def.singleUse ? ' · 单次' : ''}</small></span>
    <span class="price"><span class="c">${def.cost}💰</span><span class="left">${left}</span></span>`;
  if (usesMarketPreviewFlow) {
    // Mobile: tap = direct buy target (option B). Long-press = preview details.
    card.onclick = () => {
      if (canSelectMarketPreview) {
        env.onClick(pile.defId);
      } else {
        env.preview(pile.defId);
      }
    };
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const clearLP = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    card.addEventListener('touchstart', () => {
      clearLP();
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        env.preview(pile.defId);
      }, 420);
    }, { passive: true });
    card.addEventListener('touchend', clearLP);
    card.addEventListener('touchmove', clearLP);
    card.addEventListener('touchcancel', clearLP);
  } else if (freeTakeAction && myTurn && pile.count > 0) {
    card.onclick = () => env.onClick(pile.defId);
  } else if (locked && canPromote) card.onclick = () => env.onClick(pile.defId);
  else if (locked) card.onclick = () => env.preview(pile.defId);
  else if (!locked && pile.count > 0 && myTurn) card.onclick = () => env.onClick(pile.defId);
  env.attachPreview(card, pile.defId);
  return card;
}
