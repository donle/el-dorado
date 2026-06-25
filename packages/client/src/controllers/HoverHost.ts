/**
 * controllers/HoverHost — adapts `App` to the `HoverHost` interface
 * that `HoverStateMachine` consumes. Lives in its own file so the
 * 40+ lines of thin accessors don't pollute main.ts.
 *
 * The interface itself stays in HoverStateMachine.ts (single source
 * of truth) and is re-exported here for convenience. This file
 * exists purely to:
 *   1. group every `App.X → interaction.X` / module-helper wiring
 *      `HoverStateMachine` needs, in one place;
 *   2. let App construct the adapter with one line:
 *        `new HoverStateMachine(panel, createHoverHost(this))`.
 *
 * When the InteractionController extraction (B3) absorbs more of
 * these, the corresponding entries below can be deleted in place.
 */
import {
  blockadeMoveSymbol,
  blockadeRequiresDiscard,
  cardDefId,
  pickHandMover,
  type Axial,
  type Blockade,
  type GameState,
  type Hex,
  type MoveSymbol,
  type Player,
} from '@eldorado/core';
import type { HoverHost } from './HoverStateMachine.js';

/** Minimal App surface the adapter needs. */
export interface HoverHostSource {
  readonly state: GameState | null;
  readonly me: Player | null;
  readonly mobilePanel: 'players' | 'market' | 'log' | null;
  readonly board: HoverHost['board'];
  readonly previewCtl: HoverHost['previewCtl'];
  readonly interaction: {
    mode: 'idle' | 'clear' | 'remove' | 'trim';
    selected: Set<string>;
    nativeActionCardId: string | null;
    canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean;
    canStepToEldorado(hex: Hex): boolean;
    canUseNativeOn(hex: Hex): boolean;
    selectedHandCardIds(): string[];
    movementRequirement(hex: Hex): ReturnType<NonNullable<HoverHost['movementRequirement']>>;
    tryActOnHex(c: Axial): boolean;
    tryActOnBlockade(id: string): boolean;
    blockadeDestination(b: Blockade, sym?: MoveSymbol, power?: number): Hex | undefined;
    blockadeEdges(b: Blockade): Array<{ a: Axial; b: Axial }>;
  };
  isMyTurn(): boolean;
  hexAt(c: Axial): Hex | undefined;
  blockadeById(id: string | null): Blockade | undefined;
}

export function createHoverHost(app: HoverHostSource): HoverHost {
  const ix = app.interaction;
  return {
    board: app.board,
    previewCtl: app.previewCtl,
    getState: () => app.state,
    getMobilePanel: () => app.mobilePanel,
    isMyTurn: () => app.isMyTurn(),
    get me() { return app.me; },
    hexAt: (c) => app.hexAt(c),
    blockadeById: (id) => app.blockadeById(id),
    blockadeEdges: (b) => ix.blockadeEdges(b),
    blockadeDestination: (b, sym, power) => ix.blockadeDestination(b, sym, power),
    getMode: () => ix.mode,
    getSelected: () => ix.selected,
    getNativeActionCardId: () => ix.nativeActionCardId,
    selectedHandCardIds: () => ix.selectedHandCardIds(),
    movementRequirement: (hex) => ix.movementRequirement(hex),
    canEnter: (hex, symbol, power) => ix.canEnter(hex, symbol, power),
    canStepToEldorado: (hex) => ix.canStepToEldorado(hex),
    canUseNativeOn: (hex) => ix.canUseNativeOn(hex),
    pickHandMover: (req, cost, candidates) => pickHandMover(req, cost, candidates),
    blockadeRequiresDiscard: (b) => blockadeRequiresDiscard(b),
    blockadeMoveSymbol: (b) => blockadeMoveSymbol(b),
    cardDefId: (cardId, state) => cardDefId(cardId, state),
    tryActOnHex: (c) => ix.tryActOnHex(c),
    tryActOnBlockade: (id) => ix.tryActOnBlockade(id),
  };
}
