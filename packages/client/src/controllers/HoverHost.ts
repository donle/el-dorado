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
} from '@eldorado/core';
import type { HoverHost } from './HoverStateMachine.js';

/** Minimal App surface the adapter needs. */
export interface HoverHostSource {
  readonly state: GameState | null;
  readonly you: string | null;
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
}

export function createHoverHost(app: HoverHostSource): HoverHost {
  return {
    board: app.board,
    previewCtl: app.previewCtl,
    getState: () => app.state,
    getMobilePanel: () => app.mobilePanel,
    isMyTurn: () => !!app.state && app.state.phase === 'playing' && app.state.turn?.playerId === app.you,
    get me() { return app.state?.players.find((p) => p.id === app.you) ?? null; },
    hexAt: (c) => app.state?.hexes.find((h) => h.q === c.q && h.r === c.r),
    blockadeById: (id) => id ? app.state?.blockades.find((b) => b.id === id) : undefined,
    blockadeEdges: (b) => app.interaction.blockadeEdges(b),
    blockadeDestination: (b, sym, power) => app.interaction.blockadeDestination(b, sym, power),
    getMode: () => app.interaction.mode,
    getSelected: () => app.interaction.selected,
    getNativeActionCardId: () => app.interaction.nativeActionCardId,
    selectedHandCardIds: () => app.interaction.selectedHandCardIds(),
    movementRequirement: (hex) => app.interaction.movementRequirement(hex),
    canEnter: (hex, symbol, power) => app.interaction.canEnter(hex, symbol, power),
    canStepToEldorado: (hex) => app.interaction.canStepToEldorado(hex),
    canUseNativeOn: (hex) => app.interaction.canUseNativeOn(hex),
    pickHandMover: (req, cost, candidates) => pickHandMover(req, cost, candidates),
    blockadeRequiresDiscard: (b) => blockadeRequiresDiscard(b),
    blockadeMoveSymbol: (b) => blockadeMoveSymbol(b),
    cardDefId: (cardId, state) => cardDefId(cardId, state),
    tryActOnHex: (c) => app.interaction.tryActOnHex(c),
    tryActOnBlockade: (id) => app.interaction.tryActOnBlockade(id),
  };
}
