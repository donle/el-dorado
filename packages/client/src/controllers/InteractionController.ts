/**
 * controllers/InteractionController — owns the player's interaction state
 * (selection, mode, market/clear targets, native-action cursor) and the
 * large surface of input handlers (click → dispatch action).
 *
 * Extracted from the App god class so the heaviest cross-cluster
 * dispatcher in the client — the 30+ methods that translate a click
 * into a server `action` — lives in one place. App is now reduced to
 * the lifecycle / render / network wiring that surrounds these calls.
 *
 * The controller does NOT own game state, the socket, the Board scene,
 * the HUD, or the HoverStateMachine. It reaches all of those through
 * a thin `InteractionHost` interface, so its dependencies are explicit
 * and structural.
 */
import {
  getDef,
  pickHandMover,
  blockadeMoveSymbol,
  blockadeRequiresDiscard,
  isFinishEntrance,
  requiredFor,
  stepCost,
  sameCoord,
  cardDefId,
  type Action,
  type Axial,
  type Blockade,
  type GameState,
  type Hex,
  type MoveSymbol,
  type Player,
  type RoomView,
  isAdjacent,
  neighbors,
  movableSymbols,
} from '@eldorado/core';
import type { Mode } from './HoverStateMachine.js';

// --- pure helpers ---
//
// Pure helpers used to live as module-level functions in main.ts; they
// were duplicated here to avoid a cyclic import on App. They are now
// imported from @eldorado/core (Stage E extraction) so a single
// implementation is shared with the server and AI.

// --- host interface --------------------------------------------------

export interface InteractionHost {
  // Game state slice
  readonly state: GameState | null;
  readonly me: Player | null;
  readonly you: string | null;
  readonly room: RoomView | null;
  isMyTurn(): boolean;

  // Mobile panel state (controller writes when cancelling a market preview)
  readonly mobilePanel: 'players' | 'market' | 'log' | null;
  setMobilePanel(p: 'players' | 'market' | 'log' | null): void;

  // Networking
  sendAction(action: Action): void;

  // Board scene
  readonly board: {
    setHighlights(coords: Axial[]): void;
    setBlockadeHighlights(ids: string[]): void;
  };

  // Render & messages
  renderHud(): void;
  renderTerrainPanel(): void;  // delegates to HoverStateMachine
  flash(msg: string): void;

  // Layout (for usesMarketPreviewFlow)
  readonly mobileLayout: { isMobileDevice(): boolean };
}

// --- the controller --------------------------------------------------

export class InteractionController {
  // selection / mode
  selected = new Set<string>();
  mode: Mode = 'idle';
  // market interaction
  buyTargetDefId: string | null = null;
  promoteTargetDefId: string | null = null;
  marketPreviewDefId: string | null = null;
  // native action cursor
  nativeActionCardId: string | null = null;
  // clear-space / clear-blockade selection
  clearTarget: Axial | null = null;
  clearBlockadeId: string | null = null;
  removeAfterDrawLimit = 0;
  /** Transient hint shown in the action bar. */
  hint = '';

  constructor(private readonly host: InteractionHost) {}

  // --- pure lookups ---------------------------------------------------

  private hexAt(c: Axial): Hex | undefined {
    return this.host.state?.hexes.find((h) => h.q === c.q && h.r === c.r);
  }

  private blockadeById(id: string | null): Blockade | undefined {
    return id ? this.host.state?.blockades.find((b) => b.id === id) : undefined;
  }

  private handCardIds(): Set<string> {
    return new Set((this.host.me?.hand ?? []).map((c) => c.id));
  }

  selectedHandCardIds(): string[] {
    const handIds = this.handCardIds();
    return [...this.selected].filter((id) => handIds.has(id));
  }

  /** @internal App → HoverStateMachine */
  me(): Player | null {
    return this.host.me;
  }

  private blockadeBetween(from: Axial, to: Axial): Blockade | undefined {
    return this.host.state?.blockades.find((blockade) => {
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      return edges.some(
        (edge) =>
          (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
      );
    });
  }

  /** @internal App → HoverStateMachine */
  blockadeEdges(blockade: Blockade): Array<{ a: Axial; b: Axial }> {
    return blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  }

  /** @internal App → HoverStateMachine */
  blockadeDestination(blockade: Blockade, symbol?: MoveSymbol, power?: number): Hex | undefined {
    const me = this.host.me;
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

  // --- movement legality (pure given me + state) ---------------------

  /** @internal App → HoverStateMachine */
  movementRequirement(
    hex: Hex,
  ): { required: MoveSymbol | null; cost: number; blockade?: Blockade; discard?: boolean; destReq?: MoveSymbol | null } {
    const me = this.host.me;
    const blockade = me ? this.blockadeBetween(me.position, hex) : undefined;
    if (blockade && !blockade.claimedBy) {
      const seamSym = blockadeMoveSymbol(blockade);
      if (seamSym === null) {
        return { required: null, cost: blockade.cost, blockade, discard: true };
      }
      return { required: seamSym, cost: blockade.cost + stepCost(hex), blockade, destReq: requiredFor(hex) };
    }
    return { required: requiredFor(hex), cost: stepCost(hex) };
  }

  /** @internal App → HoverStateMachine */
  canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean {
    const me = this.host.me;
    if (!me || !isAdjacent(me.position, hex)) return false;
    if (hex.terrain === 'mountain') return false;
    const current = this.hexAt(me.position);
    if (hex.terrain === 'eldorado' && !isFinishEntrance(current)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    if (hex.terrain === 'rubble' || hex.terrain === 'basecamp') return false;
    const requirement = this.movementRequirement(hex);
    if (requirement.discard) return false;
    if (requirement.required !== null && requirement.required !== symbol) return false;
    if (requirement.destReq != null && requirement.destReq !== symbol) return false;
    return power >= requirement.cost;
  }

  /** @internal App → HoverStateMachine */
  canStepToEldorado(hex: Hex): boolean {
    const me = this.host.me;
    if (!me || hex.terrain !== 'eldorado') return false;
    if (!isAdjacent(me.position, hex)) return false;
    const current = this.hexAt(me.position);
    if (!isFinishEntrance(current)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    return !blockade || !!blockade.claimedBy;
  }

  /** @internal App → HoverStateMachine */
  canUseNativeOn(hex: Hex): boolean {
    const me = this.host.me;
    if (!me) return false;
    if (!isAdjacent(me.position, hex)) return false;
    if (hex.terrain === 'eldorado' && !isFinishEntrance(this.hexAt(me.position))) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    return !blockade || !!blockade.claimedBy;
  }

  canClearBlockade(blockade: Blockade): boolean {
    return !blockade.claimedBy && blockadeRequiresDiscard(blockade) && !!this.blockadeDestination(blockade);
  }

  canClearSpaceWithSelection(hex: Hex): boolean {
    const me = this.host.me;
    if (!me) return false;
    if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp') return false;
    if (!isAdjacent(me.position, hex)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    if (blockade && !blockade.claimedBy) return false;
    return this.selectedHandCardIds().length === hex.cost;
  }

  canRemoveBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade)
      && !!this.blockadeDestination(blockade)
      && blockadeMoveSymbol(blockade) === symbol && power >= blockade.cost;
  }

  // --- selection lifecycle -------------------------------------------

  marketNeedsPromotion(state: GameState): boolean {
    const active = state.market.filter((m) => m.onBoard && m.count > 0).length;
    return active < 6 && state.market.some((m) => !m.onBoard && m.count > 0);
  }

  resetSelection(): void {
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

  /**
   * Reconcile selection when fresh server state arrives. Transient targets
   * (buy/clear/mode) always reset, but the hand selection is PRESERVED across
   * the player's own turn so a multi-card movement chain keeps walking without
   * re-selecting — each step's played card simply drops out of the hand and is
   * pruned here. Selection is cleared entirely when it isn't our turn.
   */
  syncSelectionToState(): void {
    const wasRemoveMode = this.mode === 'remove';
    const wasTrimMode = this.mode === 'trim';
    this.mode = 'idle';
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.nativeActionCardId = null;
    this.clearTarget = null;
    this.clearBlockadeId = null;
    this.removeAfterDrawLimit = 0;
    this.hint = '';
    if (!this.host.isMyTurn() || !this.host.me) {
      this.selected.clear();
      return;
    }
    const handIds = this.handCardIds();
    for (const id of [...this.selected]) if (!handIds.has(id)) this.selected.delete(id);
    const pending = this.host.state?.turn?.pendingRemoval;
    if (pending) {
      if (!wasRemoveMode) this.selected.clear();
      this.mode = 'remove';
      this.removeAfterDrawLimit = pending.max;
      this.hint = `选择最多 ${pending.max} 张手牌移除，或直接跳过`;
    }
    const pendingTrim = this.host.state?.turn?.pendingTrim;
    if (pendingTrim) {
      if (!wasTrimMode) this.selected.clear();
      this.mode = 'trim';
      this.hint = `回合末：精简手牌到 ${pendingTrim.max} 张`;
    } else if (wasTrimMode) {
      this.selected.clear();
      this.hint = '';
    }
  }

  // --- highlights -----------------------------------------------------

  recomputeHighlights(): void {
    if (!this.host.isMyTurn() || !this.host.me) {
      this.host.board.setHighlights([]);
      this.host.board.setBlockadeHighlights([]);
      return;
    }
    const me = this.host.me;
    const adj = neighbors(me.position)
      .map((c) => this.hexAt(c))
      .filter((h): h is Hex => !!h);
    const out: Axial[] = [];
    const blockadeOut = new Set<string>();
    const state = this.host.state!;
    const mover = state.turn?.activeMover;
    const unclaimedBlockades = state.blockades.filter((b) => !b.claimedBy);

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
        const def = getDef(cardDefId(id, state));
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
    this.host.board.setHighlights(out);
    this.host.board.setBlockadeHighlights([...blockadeOut]);
  }

  // --- input dispatch: hex / blockade -------------------------------

  /** @internal App → HoverStateMachine */
  tryActOnHex(c: Axial): boolean {
    if (!this.host.isMyTurn()) return false;
    if (this.mode === 'clear' || this.mode === 'remove') return false;
    const hex = this.hexAt(c);
    const me = this.host.me;
    if (!hex || !me || !isAdjacent(me.position, hex)) return false;

    const between = this.blockadeBetween(me.position, hex);
    if (between && !between.claimedBy) {
      this.host.flash('先点连接地形移除障碍');
      return true;
    }

    if (this.nativeActionCardId) {
      if (!this.canUseNativeOn(hex)) {
        this.host.flash('原住民向导只能移动到可进入的相邻地形');
        return true;
      }
      const cardId = this.nativeActionCardId;
      this.nativeActionCardId = null;
      this.selected.delete(cardId);
      this.host.sendAction({ type: 'UseAbility', cardId, nativeTo: c });
      return true;
    }

    if (this.canStepToEldorado(hex)) {
      this.host.sendAction({ type: 'StepTo', to: c });
      return true;
    }

    // 1) Clearable terrain is paid like movement: select cards first, then target.
    if ((hex.terrain === 'rubble' || hex.terrain === 'basecamp') && !hex.occupant) {
      const cardIds = this.selectedHandCardIds();
      if (cardIds.length === 0) return false;
      if (cardIds.length !== hex.cost) {
        this.host.flash(`需要正好选择 ${hex.cost} 张手牌`);
        return true;
      }
      this.host.sendAction({ type: 'ClearSpace', to: c, cardIds });
      return true;
    }

    const state = this.host.state!;
    const mover = state.turn?.activeMover;
    if (mover && this.canEnter(hex, mover.symbol, mover.remaining)) {
      this.host.sendAction({ type: 'StepTo', to: c });
      return true;
    }
    // 3) Pick least-waste card from selected that can pay this step.
    const { required, cost } = this.movementRequirement(hex);
    const hand = this.host.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((id) => hand.some((h) => h.id === id))
      .map((id) => ({ id, defId: cardDefId(id, state) }));
    const pick = pickHandMover(required, cost, candidates);
    if (pick) {
      const pickDefId = candidates.find((c) => c.id === pick.cardId)!.defId;
      if (this.canEnter(hex, pick.symbol, getDef(pickDefId).power)) {
        this.selected.delete(pick.cardId);
        this.host.sendAction({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
        this.host.sendAction({ type: 'StepTo', to: c });
        return true;
      }
    }
    return false;
  }

  /** @internal App → HoverStateMachine */
  tryActOnBlockade(id: string): boolean {
    if (!this.host.isMyTurn()) return false;
    if (this.mode === 'clear' || this.mode === 'remove') return false;
    const blockade = this.blockadeById(id);
    if (!blockade) return false;

    const state = this.host.state!;

    // Unclaimed: REMOVE in place (do not move).
    if (!blockade.claimedBy) {
      if (!this.blockadeDestination(blockade)) return false;
      if (blockadeRequiresDiscard(blockade)) {
        this.mode = 'clear';
        this.clearBlockadeId = blockade.id;
        this.clearTarget = null; // marker: removing a blockade, not a hex
        this.selected.clear();
        this.hint = `选 ${blockade.cost} 张牌弃掉，移除这块连接地形`;
        this.host.renderHud();
        this.recomputeHighlights();
        this.host.renderTerrainPanel();
        return true;
      }
      const seamSym = blockadeMoveSymbol(blockade);
      const mover = state.turn?.activeMover;
      if (seamSym && mover && mover.symbol === seamSym && mover.remaining >= blockade.cost) {
        this.host.sendAction({ type: 'RemoveBlockade', blockadeId: blockade.id });
        return true;
      }
      const hand = this.host.me?.hand ?? [];
      const candidates = [...this.selected]
        .filter((cid) => hand.some((h) => h.id === cid))
        .map((cid) => ({ id: cid, defId: cardDefId(cid, state) }));
      const pick = pickHandMover(seamSym, blockade.cost, candidates);
      if (pick) {
        this.selected.delete(pick.cardId);
        this.host.sendAction({ type: 'RemoveBlockade', blockadeId: blockade.id, cardId: pick.cardId, symbol: pick.symbol });
        return true;
      }
      return false;
    }

    // Claimed: cross normally onto the far hex.
    const mover = state.turn?.activeMover;
    if (mover && mover.remaining > 0) {
      const dest = this.blockadeDestination(blockade, mover.symbol, mover.remaining);
      if (dest) { this.host.sendAction({ type: 'StepTo', to: { q: dest.q, r: dest.r } }); return true; }
    }
    const destGeo = this.blockadeDestination(blockade);
    if (!destGeo) return false;
    const req = this.movementRequirement(destGeo);
    const hand = this.host.me?.hand ?? [];
    const candidates = [...this.selected]
      .filter((cid) => hand.some((h) => h.id === cid))
      .map((cid) => ({ id: cid, defId: cardDefId(cid, state) }));
    const pick = pickHandMover(req.required, req.cost, candidates);
    if (pick) {
      const pickDefId = candidates.find((c) => c.id === pick.cardId)!.defId;
      const dest = this.blockadeDestination(blockade, pick.symbol, getDef(pickDefId).power);
      if (!dest) return false;
      this.selected.delete(pick.cardId);
      this.host.sendAction({ type: 'PlayMovementCard', cardId: pick.cardId, symbol: pick.symbol });
      this.host.sendAction({ type: 'StepTo', to: { q: dest.q, r: dest.r } });
      return true;
    }
    return false;
  }

  // --- input dispatch: hand cards -----------------------------------

  onCardClick(cardId: string): void {
    if (!this.host.isMyTurn()) return;
    if (this.mode === 'trim') {
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else this.selected.add(cardId);
      this.host.renderHud();
      return;
    }
    if (this.mode === 'remove') {
      const handIds = this.handCardIds();
      if (!handIds.has(cardId)) return;
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else if (this.selectedHandCardIds().length < this.removeAfterDrawLimit) this.selected.add(cardId);
      else this.host.flash(`最多移除 ${this.removeAfterDrawLimit} 张手牌`);
      this.host.renderHud();
      this.host.renderTerrainPanel();
      return;
    }
    if (this.mode === 'clear') {
      const cost = this.clearBlockadeId
        ? this.blockadeById(this.clearBlockadeId)?.cost ?? 0
        : this.hexAt(this.clearTarget!)?.cost ?? 0;
      if (this.selected.has(cardId)) this.selected.delete(cardId);
      else if (this.selected.size < cost) this.selected.add(cardId);
      else this.host.flash(`最多选择 ${cost} 张牌`);
      if (this.selected.size === cost) {
        if (this.clearBlockadeId) {
          this.host.sendAction({ type: 'RemoveBlockade', blockadeId: this.clearBlockadeId, cardIds: [...this.selected] });
        } else if (this.clearTarget) {
          this.host.sendAction({ type: 'ClearSpace', to: this.clearTarget, cardIds: [...this.selected] });
        }
        return;
      }
      this.host.renderHud();
      this.host.renderTerrainPanel();
      return;
    }
    this.nativeActionCardId = null;
    if (this.selected.has(cardId)) this.selected.delete(cardId);
    else this.selected.add(cardId);
    this.promoteTargetDefId = null;
    // Only clear the market buy target when the user is switching to an actual
    // action card (other than "take_free"). Adding a non-action hand card to
    // the payment selection must NOT drop the buy target — otherwise tapping
    // a 1💰 traveller to pay for a 1💰 market card wipes the target and
    // leaves a floating preview where the buy bar should be.
    const action = this.selectedActionCard();
    if (action && action.def.ability !== 'take_free') this.buyTargetDefId = null;
    this.recomputeHighlights();
    this.host.renderHud();
    this.host.renderTerrainPanel();
  }

  // --- market panel input -------------------------------------------

  usesMarketPreviewFlow(): boolean {
    if (this.host.mobilePanel !== 'market') return false;
    return document.body.classList.contains('mobile-device')
      || window.matchMedia('(max-width: 760px)').matches
      || window.matchMedia('(max-height: 500px) and (orientation: landscape)').matches;
  }

  onMarketClick(defId: string): void {
    const state = this.host.state;
    if (!state) return;
    if (!this.host.isMyTurn()) {
      this.previewMarketCard(defId);
      return;
    }
    if (this.mode === 'remove') {
      this.host.flash('请先处理要移除的手牌');
      return;
    }
    this.marketPreviewDefId = null;
    const pile = state.market.find((m) => m.defId === defId);
    if (!pile || pile.count <= 0) {
      this.host.flash('这张牌当前无法选择');
      return;
    }
    // On mobile (preview flow) the drawer stays open after a buy/promote target
    // is set so the user can see the sticky summary bar with the confirm button.
    // Desktop still auto-closes the market drawer — the right-hand panel would
    // overlap the action-bar otherwise.
    const stayOpen = this.usesMarketPreviewFlow();

    if (this.selectedActionCard()?.def.ability === 'take_free') {
      this.promoteTargetDefId = null;
      this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
      this.hint = this.buyTargetDefId ? '点击「免费获得」使用发报机' : '';
      if (this.buyTargetDefId && !stayOpen) this.host.setMobilePanel(null);
      this.host.renderHud();
      return;
    }
    if (state.turn?.hasBought) { this.host.flash('本回合已购买 · 每回合限买 1 张'); return; }
    if (!pile.onBoard) {
      this.buyTargetDefId = null;
      if (!this.marketNeedsPromotion(state)) {
        this.marketPreviewDefId = defId;
        this.hint = '候补牌需要市场有空位才能放入';
        this.host.renderHud();
        return;
      }
      this.promoteTargetDefId = this.promoteTargetDefId === defId ? null : defId;
      this.hint = this.promoteTargetDefId ? '点击「放入市场」补位' : '';
      if (this.promoteTargetDefId && !stayOpen) this.host.setMobilePanel(null);
      this.host.renderHud();
      return;
    }
    this.promoteTargetDefId = null;
    this.buyTargetDefId = this.buyTargetDefId === defId ? null : defId;
    this.hint = this.buyTargetDefId ? '选手牌支付，然后点「确认购买」' : '';
    if (this.buyTargetDefId && !stayOpen) this.host.setMobilePanel(null);
    this.host.renderHud();
  }

  previewMarketCard(defId: string): void {
    this.marketPreviewDefId = this.marketPreviewDefId === defId ? null : defId;
    if (this.marketPreviewDefId) {
      this.buyTargetDefId = null;
      this.promoteTargetDefId = null;
    }
    this.host.renderHud();
  }

  selectMarketPreviewCard(): void {
    const defId = this.marketPreviewDefId;
    const state = this.host.state;
    if (!defId || !state) return;

    const pile = state.market.find((m) => m.defId === defId);
    this.marketPreviewDefId = null;
    if (!pile || pile.count <= 0) {
      this.host.flash('这张牌当前无法选择');
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

  canSelectMarketPreview(defId: string): boolean {
    const state = this.host.state;
    if (!this.host.isMyTurn() || !state) return false;
    const pile = state.market.find((m) => m.defId === defId);
    if (!pile || pile.count <= 0) return false;
    if (this.selectedActionCard()?.def.ability === 'take_free') return true;
    if (state.turn?.hasBought) return false;
    if (pile.onBoard) return true;
    return this.marketNeedsPromotion(state);
  }

  // --- action card helpers ------------------------------------------

  selectedActionCards(): Array<{ id: string; defId: string; def: ReturnType<typeof getDef> }> {
    const hand = this.host.me?.hand ?? [];
    return [...this.selected]
      .map((id) => {
        const card = hand.find((h) => h.id === id);
        if (!card) return null;
        const def = getDef(card.defId);
        return def.kind === 'action' ? { id, defId: card.defId, def } : null;
      })
      .filter((x): x is { id: string; defId: string; def: ReturnType<typeof getDef> } => !!x);
  }

  selectedActionCard(): { id: string; defId: string; def: ReturnType<typeof getDef> } | null {
    const actions = this.selectedActionCards();
    return actions.length === 1 ? actions[0] : null;
  }

  selectedActionRemoveIds(actionCardId: string): string[] {
    const handIds = this.handCardIds();
    return [...this.selected].filter((id) => id !== actionCardId && handIds.has(id));
  }

  removeLimitForAbility(ability: string | undefined): number {
    if (ability === 'draw1_remove1') return 1;
    if (ability === 'draw2_remove2') return 2;
    return 0;
  }

  selectedActionUseLabel(compact = false): string {
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

  handActionUseLabel(def: ReturnType<typeof getDef>): string {
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

  canUseSelectedAction(): boolean {
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

  useActionCardFromHand(cardId: string): void {
    if (!this.host.isMyTurn()) return;
    if (this.mode === 'remove') {
      this.host.flash('请先处理要移除的手牌');
      return;
    }
    const hand = this.host.me?.hand ?? [];
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

  useSelectedAction(): void {
    if (this.mode === 'remove') {
      this.host.flash('请先处理要移除的手牌');
      return;
    }
    const actions = this.selectedActionCards();
    if (actions.length === 0) {
      this.host.flash('先选择一张行动牌');
      return;
    }
    if (actions.length > 1) {
      this.host.flash('一次只能使用一张行动牌');
      return;
    }
    const action = actions[0];
    const removeCardIds = this.selectedActionRemoveIds(action.id);

    switch (action.def.ability) {
      case 'draw2':
      case 'draw3':
        if (removeCardIds.length > 0) {
          this.host.flash('这张行动牌不需要选择其他手牌');
          return;
        }
        this.host.sendAction({ type: 'UseAbility', cardId: action.id });
        return;
      case 'draw1_remove1':
      case 'draw2_remove2': {
        if (removeCardIds.length > 0) {
          this.host.flash('先使用行动牌，摸牌后再选择要移除的手牌');
          return;
        }
        this.host.sendAction({ type: 'UseAbility', cardId: action.id });
        return;
      }
      case 'take_free':
        if (!this.buyTargetDefId) {
          this.host.setMobilePanel('market');
          this.host.flash('先选择一张市场卡');
          this.host.renderHud();
          return;
        }
        this.host.sendAction({ type: 'UseAbility', cardId: action.id, takeDefId: this.buyTargetDefId });
        this.buyTargetDefId = null;
        return;
      case 'native':
        this.nativeActionCardId = action.id;
        this.hint = '点选一个相邻地形，使用原住民向导移动';
        this.recomputeHighlights();
        this.host.renderHud();
        return;
      default:
        this.host.flash('这个行动牌能力尚未实现');
    }
  }

  // --- confirm dispatches -------------------------------------------

  promoteMarket(defId: string): void {
    const state = this.host.state!;
    if (!this.host.isMyTurn()) return;
    if (this.mode === 'remove') {
      this.host.flash('请先处理要移除的手牌');
      return;
    }
    if (state.turn?.hasBought) {
      this.host.flash('购买后不能补位 · 由下一位玩家选择');
      return;
    }
    if (!this.marketNeedsPromotion(state)) {
      this.host.flash('当前市场没有空位');
      return;
    }
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.hint = '';
    this.host.sendAction({ type: 'PromoteMarket', defId });
  }

  confirmPromoteMarket(): void {
    if (!this.promoteTargetDefId) return;
    this.promoteMarket(this.promoteTargetDefId);
  }

  confirmBuy(): void {
    if (!this.buyTargetDefId) return;
    if (this.mode === 'remove') {
      this.host.flash('请先处理要移除的手牌');
      return;
    }
    this.host.sendAction({ type: 'BuyCard', defId: this.buyTargetDefId, paymentCardIds: [...this.selected] });
  }

  /** Cancel the drawer-buy / promote / market-preview flow without acting. */
  cancelDrawerBuy(): void {
    this.buyTargetDefId = null;
    this.promoteTargetDefId = null;
    this.marketPreviewDefId = null;
    this.hint = '';
    this.host.renderHud();
  }

  /** Clear just the market-preview flag (mobile toolbar wires this up). */
  clearMarketPreview(): void {
    this.marketPreviewDefId = null;
  }

  confirmRemoveAfterDraw(): void {
    if (!this.host.isMyTurn() || this.mode !== 'remove') return;
    const cardIds = this.selectedHandCardIds();
    if (cardIds.length > this.removeAfterDrawLimit) {
      this.host.flash(`最多移除 ${this.removeAfterDrawLimit} 张手牌`);
      return;
    }
    this.host.sendAction({ type: 'RemoveCards', cardIds });
  }

  confirmTrim(): void {
    if (this.mode !== 'trim') return;
    this.host.sendAction({
      type: 'DiscardCards',
      cardIds: [...this.selected],
    });
  }

  cancelMode(): void {
    this.resetSelection();
    this.host.renderHud();
    this.recomputeHighlights();
  }

  // --- query helpers for renderHud / HoverStateMachine --------------

  /** True when something is "pinned" open (selected card, market target, etc). */
  isPinned(): boolean {
    return this.selected.size > 0 || !!this.buyTargetDefId || !!this.promoteTargetDefId || !!this.marketPreviewDefId;
  }
}
