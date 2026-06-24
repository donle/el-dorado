/**
 * Right-side market panel: title, on-board cards, upcoming cards, and the
 * in-drawer buy/promote footer.
 *
 * Pure renderer: builds the `HTMLElement` representing the market panel. The
 * owning controller wires click + preview handlers through the env, and the
 * scrim stays on the App side so it can append to the hud.
 */
import { getDef, type GameState, type MarketPile } from '@eldorado/core';
import { button, el, escapeHtml } from '../common/dom.js';
import { renderMarketSlot, type MarketSlotState } from './MarketSlot.js';

export interface MarketPanelState {
  /** Full market pile list (on-board + upcoming). */
  market: ReadonlyArray<MarketPile>;
  /** True when it's the local player's turn. */
  myTurn: boolean;
  /** Current game phase (pinned to state). */
  phase: GameState['phase'];
  /** True when the mobile market drawer is currently open (panel gets .open). */
  mobilePanelOpen: boolean;
  /** defId currently being bought, if any. */
  buyTargetDefId: string | null;
  /** defId currently being promoted into an on-board slot, if any. */
  promoteTargetDefId: string | null;
  /** defId currently previewed inline in the drawer, if any. */
  marketPreviewDefId: string | null;
  /** True when the mobile preview flow is in use (gates long-press handler). */
  usesMarketPreviewFlow: boolean;
  /** Gate for the .target buy/promote class. */
  canPromote: boolean;
  /** True when at least one on-board slot is empty and an upcoming pile exists. */
  needsPromotion: boolean;
  /** True when the active action card is Transmitter (take_free). */
  freeTakeAction: boolean;
  /** True when the player has already bought this turn. */
  hasBought: boolean;
  /** Sum of coin values of the cards the local player has selected. */
  selectedCoinSum: number;
  /** defId whose inline detail block should be appended, if any. */
  inlineDetailDefId: string | null;
  /** Previous scrollTop to restore on the next render, if any. */
  previousScrollTop: number | null;
}

export interface MarketPanelEnv {
  /** Called for every rendered slot so the host can track it (e.g. shopEls map). */
  onSlotRendered: (slotEl: HTMLElement, defId: string) => void;
  /** Generic market click (mobile preview gate already applied by caller). */
  onMarketClick: (defId: string) => void;
  /** Show the inline market preview for a defId. */
  previewMarketCard: (defId: string) => void;
  /** Confirm the current promote target. */
  confirmPromoteMarket: () => void;
  /** Confirm the current buy target. */
  confirmBuy: () => void;
  /** Cancel the current drawer buy/promote (clears target + preview + hint). */
  cancelDrawerBuy: () => void;
  /** Forward `attachPreview` from the host App. */
  attachPreview: (node: HTMLElement, defId: string) => void;
  /** Forward `attachSheetDismiss` from the host App (mobile only). */
  attachSheetDismiss: (panel: HTMLElement) => void;
  /** Render the inline detail body for a defId (mirrors marketInlineDetailHtml). */
  renderInlineDetail: (defId: string) => string;
  /** Mobile preview gate — true iff a tap on this slot should be a buy/promote click. */
  canSelectMarketPreview: (defId: string) => boolean;
}

/** Build the right-side market panel DOM element. */
export function renderMarketPanel(state: MarketPanelState, env: MarketPanelEnv): HTMLElement {
  const market = el('div', `market-panel panel ${state.mobilePanelOpen ? 'open' : ''}`);
  const onBoard = state.market.filter((m) => m.onBoard && m.count > 0);
  const upcoming = state.market.filter((m) => !m.onBoard && m.count > 0);

  const bought = state.myTurn && state.hasBought;
  const marketTitle = state.needsPromotion
    ? state.canPromote ? '在售有空位' : '候补市场'
    : bought ? '本回合已购买' : '在售';
  market.innerHTML = `<h3>市场 · ${marketTitle}</h3>`;

  const renderSlot = (pile: MarketPile, locked: boolean): void => {
    const def = getDef(pile.defId);
    const slotEl = renderMarketSlot(
      {
        pile,
        locked,
        def,
        selectedDefId: state.buyTargetDefId ?? state.promoteTargetDefId,
        previewDefId: state.marketPreviewDefId,
        canPromote: state.canPromote,
        myTurn: state.myTurn,
        usesMarketPreviewFlow: state.usesMarketPreviewFlow,
        freeTakeAction: state.freeTakeAction,
        canSelectMarketPreview: env.canSelectMarketPreview(pile.defId),
      } satisfies MarketSlotState,
      {
        onClick: env.onMarketClick,
        preview: env.previewMarketCard,
        attachPreview: env.attachPreview,
      },
    );
    market.appendChild(slotEl);
    env.onSlotRendered(slotEl, pile.defId);
    if (state.inlineDetailDefId === pile.defId) {
      const detail = el('div', 'market-detail');
      detail.innerHTML = env.renderInlineDetail(pile.defId);
      market.appendChild(detail);
    }
  };

  for (const pile of onBoard) renderSlot(pile, false);
  if (upcoming.length) {
    const sub = el('h3', '');
    sub.textContent = `${state.canPromote ? '候补可补位' : '候补市场'} · ${upcoming.length}`;
    sub.style.marginTop = '14px';
    market.appendChild(sub);
    for (const pile of upcoming) renderSlot(pile, true);
  }

  // In-drawer buy/promote footer: only rendered on mobile when a buy or
  // promote target is set. The footer sits at the bottom of the drawer's
  // scroll area so it stays visible while the user scrolls market cards —
  // and crucially it doesn't sit above the hand cards, so the hand area
  // stays unobstructed.
  const inDrawerBuyMode = state.mobilePanelOpen
    && (state.buyTargetDefId !== null || state.promoteTargetDefId !== null)
    && state.usesMarketPreviewFlow;
  if (inDrawerBuyMode) {
    appendDrawerFooter(market, state, env);
  }

  if (state.previousScrollTop !== null) {
    const restoreMarketScroll = () => {
      market.scrollTop = Math.min(
        state.previousScrollTop as number,
        Math.max(0, market.scrollHeight - market.clientHeight),
      );
    };
    restoreMarketScroll();
    requestAnimationFrame(restoreMarketScroll);
  }

  if (state.mobilePanelOpen) env.attachSheetDismiss(market);
  return market;
}

function appendDrawerFooter(
  market: HTMLElement,
  state: MarketPanelState,
  env: MarketPanelEnv,
): void {
  const footer = el('div', 'drawer-footer');
  const info = el('div', 'drawer-footer-info');
  if (state.promoteTargetDefId) {
    const def = getDef(state.promoteTargetDefId);
    info.innerHTML = `<b>放入市场</b><span>${escapeHtml(def.name)}</span>`;
  } else if (state.buyTargetDefId) {
    const def = getDef(state.buyTargetDefId);
    const cost = def.cost;
    const have = state.selectedCoinSum;
    if (state.freeTakeAction) {
      info.innerHTML = `<b>免费获得 ${escapeHtml(def.name)}</b><span>使用发报机，不消耗金币</span>`;
    } else {
      info.innerHTML = `<b>购买 ${escapeHtml(def.name)}</b><span>已选 ${have}/${cost} 金币</span>`;
    }
  }
  footer.appendChild(info);

  const cancelBtn = button('取消', () => env.cancelDrawerBuy(), true);
  cancelBtn.classList.add('cmd-btn', 'drawer-footer-cancel');
  footer.appendChild(cancelBtn);

  if (state.promoteTargetDefId) {
    const promote = button('确认放入', () => env.confirmPromoteMarket(), false);
    promote.className = 'gold cmd-btn drawer-footer-confirm';
    footer.appendChild(promote);
  } else if (state.buyTargetDefId) {
    const def = getDef(state.buyTargetDefId);
    const cost = def.cost;
    const have = state.selectedCoinSum;
    const freeTake = state.freeTakeAction;
    const buy = button(
      freeTake ? '确认获得' : have < cost ? `差 ${cost - have} 金币` : '确认购买',
      () => env.confirmBuy(),
      false,
    );
    buy.className = 'gold cmd-btn drawer-footer-confirm';
    buy.disabled = !freeTake && have < cost;
    footer.appendChild(buy);
  }

  market.appendChild(footer);
}
