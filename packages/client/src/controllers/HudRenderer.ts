/**
 * controllers/HudRenderer — owns the in-game HUD composition
 * (top bar, mobile toolbar, player bar, market, action log, hand
 * dock, turn info panel, overlays). Extracted from the App god class
 * so the render pipeline can evolve independently of networking,
 * state, and the various controllers.
 *
 * The renderer reads game state, interaction state, settings, and
 * player identity through a `HudHost`. It writes DOM maps
 * (`handEls`, `shopEls`, `playerCardEls`, `drawPileEl`,
 * `discardPileEl`) back through a small `HudDomRefs` so the
 * BoardCoordinator and other consumers can still find the cards
 * they need (e.g. for buy animations).
 *
 * No state of its own — every render is a pure function of
 * `host.state` plus whatever the host surfaces.
 */
import {
  CARD_DEFS,
  HAND_SIZE,
  cardDefId,
  coinValue,
  getDef,
  progressOf,
  type Axial,
  type GameState,
  type Hex,
  type RoomView,
  type Blockade,
  type Action,
} from '@eldorado/core';
import { el, playerDisplayName } from '../views/common/dom.js';
import { renderHandPanel } from '../views/hand/HandPanel.js';
import { renderMarketPanel } from '../views/market/MarketPanel.js';
import { renderPlayerBar } from '../views/players/PlayerBar.js';
import { renderTurnInfoPanel, type ActionCardPrompt } from '../views/turn/TurnInfoPanel.js';
import {
  buildGearDock,
  buildMobileToolbar,
  buildTopBar,
} from '../views/hud/ChromeBars.js';
import { marketInlineDetailHtml } from '../views/cards/CardDescription.js';
import type { ActionLogPanel } from './ActionLogPanel.js';
import type { CardPreviewController } from './CardPreviewController.js';
import type { MobileLayoutProbe } from './MobileLayoutProbe.js';
import type { OverlaysController } from './OverlaysController.js';
import type { PlayerHandPanel } from './PlayerHandPanel.js';
import type { SettingsMenuController } from './SettingsMenuController.js';
import type { HoverStateMachine } from './HoverStateMachine.js';

/** DOM maps the renderer fills and the BoardCoordinator / others read. */
export interface HudDomRefs {
  readonly handEls: Map<string, HTMLElement>;
  readonly shopEls: Map<string, HTMLElement>;
  readonly playerCardEls: Map<string, HTMLElement>;
  drawPileEl: HTMLElement | null;
  discardPileEl: HTMLElement | null;
}

/** Minimal read shape InteractionController must satisfy for HUD inputs. */
export interface HudInteraction {
  readonly selected: Set<string>;
  readonly mode: 'idle' | 'clear' | 'remove' | 'trim';
  readonly buyTargetDefId: string | null;
  readonly promoteTargetDefId: string | null;
  readonly marketPreviewDefId: string | null;
  readonly clearBlockadeId: string | null;
  readonly clearTarget: Axial | null;
  readonly removeAfterDrawLimit: number;
  readonly nativeActionCardId: string | null;
  selectedActionCard(): { def: { ability?: string } } | null;
  selectedActionCards(): Array<{ id: string; def: { name: string; ability?: string } }>;
  selectedActionUseLabel(compact: boolean): string;
  handActionUseLabel(def: { kind: string }): string;
  removeLimitForAbility(ability: string | undefined): number;
  selectedActionRemoveIds(cardId: string): string[];
  canUseSelectedAction(): boolean;
  usesMarketPreviewFlow(): boolean;
  canSelectMarketPreview(defId: string): boolean;
  onCardClick(cardId: string): void;
  onMarketClick(defId: string): void;
  previewMarketCard(defId: string): void;
  useActionCardFromHand(cardId: string): void;
  confirmRemoveAfterDraw(): void;
  cancelMode(): void;
  confirmTrim(): void;
  confirmPromoteMarket(): void;
  confirmBuy(): void;
  cancelDrawerBuy(): void;
  clearMarketPreview(): void;
  useSelectedAction(): void;
}

/** The shape the HUD renderer needs from its host (App today). */
export interface HudHost {
  readonly state: GameState | null;
  readonly hud: HTMLElement;
  readonly room: RoomView | null;
  readonly you: string | null;
  readonly viewMode: '3d' | '2d';
  readonly error: string;
  readonly mobilePanel: 'players' | 'market' | 'log' | null;
  readonly mobileLayout: MobileLayoutProbe;
  readonly settingsCtl: SettingsMenuController;
  readonly overlays: OverlaysController;
  readonly interaction: HudInteraction;
  readonly previewCtl: CardPreviewController;
  readonly hoverMachine: HoverStateMachine;
  readonly playerHandCtl: PlayerHandPanel;
  readonly actionLogPanel: ActionLogPanel;
  readonly dom: HudDomRefs;

  isMyTurn(): boolean;
  closeMobilePanel(): void;
  hexAt(c: Axial): Hex | undefined;
  blockadeById(id: string | null): Blockade | undefined;
  makePile(kind: 'draw' | 'discard', label: string, count: number): HTMLElement;
  /** Send a game action to the server. */
  act(action: Action): void;
}

export class HudRenderer {
  constructor(private readonly host: HudHost) {}

  render(): void {
    this.host.previewCtl.hidePreview();
    const previousMarketScrollTop = this.host.mobilePanel === 'market'
      ? this.host.hud.querySelector<HTMLElement>('.market-panel.open')?.scrollTop ?? null
      : null;
    const state = this.host.state;
    if (!state || state.phase === 'lobby') {
      this.host.hud.innerHTML = '';
      return;
    }
    const s = state;
    const myTurn = this.host.isMyTurn();
    const turnPlayer = s.players.find((p) => p.id === s.turn?.playerId);
    const turnName = turnPlayer ? playerDisplayName(turnPlayer) : '';
    this.host.hud.innerHTML = '';
    this.host.dom.handEls.clear();
    this.host.dom.shopEls.clear();

    this.host.hud.appendChild(buildGearDock({
      onToggle: () => this.host.settingsCtl.toggleSettings(),
      isOpen: this.host.settingsCtl.isOpen(),
    }));

    // --- top bar ---
    this.host.hud.appendChild(buildTopBar({
      state: s,
      myTurn,
      roomCode: this.host.room?.code ?? null,
      viewMode: this.host.viewMode,
    }));

    if (this.host.settingsCtl.isOpen()) this.host.settingsCtl.renderSettingsMenu(s);

    // --- mobile toolbar (log + market sheet toggles) ---
    this.host.hud.appendChild(buildMobileToolbar({
      getOpen: () => this.host.mobilePanel,
      toggle: (which) => this.host.overlays.toggleMobilePanel(which),
      clearMarketPreview: () => this.host.interaction.clearMarketPreview(),
      renderHud: () => this.render(),
    }));

    // --- top-centre: players as cards ---
    this.host.dom.playerCardEls.clear();
    this.host.hud.appendChild(
      renderPlayerBar(
        {
          players: s.players,
          turnOrder: s.turnOrder,
          turnPlayerId: s.turn?.playerId ?? null,
          selfId: this.host.you,
          pinnedPlayerId: this.host.playerHandCtl.getPinnedPlayerId(),
          progressOf: (p) => progressOf(p, s),
        },
        {
          onCardClick: (id) => this.host.playerHandCtl.toggle(id),
          onCardRendered: (cardEl, id) => this.host.dom.playerCardEls.set(id, cardEl),
        },
      ),
    );

    // --- right: market (all 18 cards; on-board buyable, others upcoming) ---
    const onBoard = s.market.filter((m) => m.onBoard && m.count > 0);
    const upcoming = s.market.filter((m) => !m.onBoard && m.count > 0);
    const needsPromotion = onBoard.length < 6 && upcoming.length > 0;
    const canPromote = myTurn && needsPromotion && !s.turn?.hasBought;
    const freeTakeAction = this.host.interaction.selectedActionCard()?.def.ability === 'take_free';
    const inlineMarketDetailDefId = this.host.interaction.usesMarketPreviewFlow()
      ? this.host.interaction.marketPreviewDefId
        ?? this.host.interaction.buyTargetDefId
        ?? this.host.interaction.promoteTargetDefId
      : null;
    const selectedCoinSum = [...this.host.interaction.selected]
      .reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
    const market = renderMarketPanel(
      {
        market: s.market,
        myTurn,
        phase: s.phase,
        mobilePanelOpen: this.host.mobilePanel === 'market',
        buyTargetDefId: this.host.interaction.buyTargetDefId,
        promoteTargetDefId: this.host.interaction.promoteTargetDefId,
        marketPreviewDefId: this.host.interaction.marketPreviewDefId,
        usesMarketPreviewFlow: this.host.interaction.usesMarketPreviewFlow(),
        canPromote,
        needsPromotion,
        freeTakeAction,
        hasBought: !!s.turn?.hasBought,
        selectedCoinSum,
        inlineDetailDefId: inlineMarketDetailDefId,
        previousScrollTop: previousMarketScrollTop,
      },
      {
        onSlotRendered: (slotEl, defId) => this.host.dom.shopEls.set(defId, slotEl),
        onMarketClick: (defId) => this.host.interaction.onMarketClick(defId),
        previewMarketCard: (defId) => this.host.interaction.previewMarketCard(defId),
        confirmPromoteMarket: () => this.host.interaction.confirmPromoteMarket(),
        confirmBuy: () => this.host.interaction.confirmBuy(),
        cancelDrawerBuy: () => this.host.interaction.cancelDrawerBuy(),
        attachPreview: (node, defId) => this.host.previewCtl.attachPreview(node, defId),
        attachSheetDismiss: (panel) => this.host.overlays.attachSheetDismiss(panel),
        renderInlineDetail: (defId) => marketInlineDetailHtml(defId),
        canSelectMarketPreview: (defId) => this.host.interaction.canSelectMarketPreview(defId),
      },
    );
    this.host.hud.appendChild(market);

    // Mobile: a tap-to-dismiss scrim on the open sheet (swipe-down is wired
    // inside renderMarketPanel via attachSheetDismiss when the panel opens).
    if (this.host.mobilePanel === 'market') {
      const scrim = el('div', 'sheet-scrim');
      scrim.onclick = () => this.host.closeMobilePanel();
      this.host.hud.appendChild(scrim);
    }
    if (this.host.mobilePanel === 'log') {
      this.host.actionLogPanel.renderMobileDialog();
    }

    this.host.actionLogPanel.renderInto();

    // (draw/discard piles are built into the bottom dock, flanking the hand)

    // --- bottom dock: hand + actions ---
    const dock = el('div', 'dock');
    const me = s.players.find((p) => p.id === this.host.you) ?? null;
    const tray = renderHandPanel(
      {
        me,
        myTurn,
        phase: s.phase,
        selectedIds: this.host.interaction.selected,
        modeIsRemove: this.host.interaction.mode === 'remove',
        useLabelFor: (defId) => this.host.interaction.handActionUseLabel(getDef(defId)),
        defIdFor: (cardId) => cardDefId(cardId, s),
        attachPreview: (node, defId) => this.host.previewCtl.attachPreview(node, defId),
      },
      {
        onCardClick: (cardId) => this.host.interaction.onCardClick(cardId),
        onUseClick: (cardId, ev) => {
          ev.stopPropagation();
          this.host.interaction.useActionCardFromHand(cardId);
        },
      },
    );
    this.host.dom.handEls.clear();
    if (me) {
      for (const c of me.hand) {
        const def = getDef(c.defId);
        if (!CARD_DEFS[c.defId]) continue;
        this.host.dom.handEls.set(c.id, tray.querySelector<HTMLElement>(`.card.${def.kind}`) ?? tray);
      }
    }

    const turnActionCards = this.host.interaction.selectedActionCards();
    const turnActionCard = turnActionCards.length === 1 ? turnActionCards[0] : null;
    const turnActionPrompt: ActionCardPrompt | null = turnActionCard
      ? {
          count: 1,
          name: turnActionCard.def.name,
          ability: turnActionCard.def.ability,
          removeLimit: this.host.interaction.removeLimitForAbility(turnActionCard.def.ability),
          removeSelectedCount: this.host.interaction.selectedActionRemoveIds(turnActionCard.id).length,
        }
      : turnActionCards.length > 1
        ? { count: turnActionCards.length, name: '', ability: '', removeLimit: 0, removeSelectedCount: 0 }
        : null;
    const turnCost = this.host.interaction.buyTargetDefId ? getDef(this.host.interaction.buyTargetDefId).cost : null;
    const turnCoinHave = [...this.host.interaction.selected].reduce((sum, id) => sum + coinValue(cardDefId(id, s)), 0);
    const turnCompact = this.host.mobileLayout.isCompactCommandLayout();
    const turnHasActionCards = turnActionCards.length > 0 || !!this.host.interaction.nativeActionCardId;
    const turnUseLabel = this.host.interaction.nativeActionCardId
      ? (turnCompact ? '选目标' : '选择向导目标')
      : this.host.interaction.selectedActionUseLabel(turnCompact);
    const turnRemoveCount = me ? me.hand.filter((c) => this.host.interaction.selected.has(c.id)).length : 0;
    const turnHandSize = me?.hand.length ?? 0;
    const turnTrimMin = Math.max(0, turnHandSize - HAND_SIZE);
    const turnTakeFree = this.host.interaction.selectedActionCard()?.def.ability === 'take_free';
    const turnMarketNeedsPromotion = onBoard.length < 6 && upcoming.length > 0;
    const turnClearCost = this.host.interaction.clearBlockadeId
      ? this.host.blockadeById(this.host.interaction.clearBlockadeId)?.cost ?? 0
      : this.host.interaction.clearTarget
        ? this.host.hexAt(this.host.interaction.clearTarget)?.cost ?? 0
        : 0;
    const bar = renderTurnInfoPanel(
      {
        myTurn,
        phase: s.phase,
        turnName,
        me,
        state: s,
        mode: this.host.interaction.mode,
        removeAfterDrawLimit: this.host.interaction.removeAfterDrawLimit,
        pendingTrim: !!s.turn?.pendingTrim,
        handSizeLimit: HAND_SIZE,
        promoteTargetDefId: this.host.interaction.promoteTargetDefId,
        buyTargetDefId: this.host.interaction.buyTargetDefId,
        cost: turnCost,
        coinHave: turnCoinHave,
        hasActionCards: turnHasActionCards,
        nativeActionCardId: this.host.interaction.nativeActionCardId,
        takeFreeSelected: turnTakeFree,
        actionPrompt: turnActionPrompt,
        useLabel: turnUseLabel,
        useDisabled: !!this.host.interaction.nativeActionCardId,
        canUseAction: this.host.interaction.canUseSelectedAction(),
        removeCount: turnRemoveCount,
        trimSel: turnRemoveCount,
        trimMin: turnTrimMin,
        isCompact: turnCompact,
        marketNeedsPromotion: turnMarketNeedsPromotion,
        selectedCount: this.host.interaction.selected.size,
        clearCost: turnClearCost,
        clearIsBlockade: !!this.host.interaction.clearBlockadeId,
      },
      {
        onConfirmRemove: () => this.host.interaction.confirmRemoveAfterDraw(),
        onCancelMode: () => this.host.interaction.cancelMode(),
        onConfirmTrim: () => this.host.interaction.confirmTrim(),
        onConfirmPromote: () => this.host.interaction.confirmPromoteMarket(),
        onConfirmBuy: () => this.host.interaction.confirmBuy(),
        onUseAction: () => this.host.interaction.useSelectedAction(),
        onEndTurn: () => this.host.act({ type: 'EndTurn' }),
        onDiscard: () => {
          if (this.host.interaction.selected.size === 0) return;
          this.host.act({ type: 'DiscardCards', cardIds: [...this.host.interaction.selected] });
        },
      },
    );
    // Piles flank the hand on the same row; draw on the left, discard on the right.
    if (me) {
      const drawPile = this.host.makePile('draw', '摸牌', me.deck.length);
      const discardPile = this.host.makePile('discard', '弃牌', me.discard.length);
      this.host.dom.drawPileEl = drawPile;
      this.host.dom.discardPileEl = discardPile;
      dock.appendChild(drawPile);
      dock.appendChild(tray);
      dock.appendChild(discardPile);
    } else {
      this.host.dom.drawPileEl = null;
      this.host.dom.discardPileEl = null;
      dock.appendChild(tray);
    }
    this.host.hud.appendChild(dock);
    this.host.hud.appendChild(bar); // floats bottom-right

    // Keep the selected card's preview open (no hover needed — for touch).
    this.host.previewCtl.refreshPinnedPreview();

    if (this.host.error) {
      const t = el('div', 'toast');
      t.textContent = this.host.error;
      this.host.hud.appendChild(t);
    }
    if (s.phase === 'finished') this.host.overlays.renderGameOverOverlay(s);
    this.host.hoverMachine.renderTerrainPanel();
    // 出牌 / 摸牌后手牌变了，pinned 玩家手牌面板要反映最新数据；
    // renderHud 已经重建了玩家卡 DOM（pinned-hand class 重新挂上），这里刷新 panel 内容
    if (this.host.playerHandCtl.getPinnedPlayerId()) this.host.playerHandCtl.refresh();
  }
}
