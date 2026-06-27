/**
 * interaction/legality — pure decision-table functions for movement and
 * interaction legality. Extracted from InteractionController so they can
 * be tested in isolation and don't clutter the controller's input dispatch.
 */
import {
  blockadeMoveSymbol,
  blockadeRequiresDiscard,
  isFinishEntrance,
  requiredFor,
  sameCoord,
  stepCost,
  type Axial,
  type Blockade,
  type GameState,
  type Hex,
  type MoveSymbol,
  type Player,
  isAdjacent,
} from '@eldorado/core';

export interface LegalityContext {
  readonly state: GameState | null;
  readonly me: Player | null;
}

export class LegalityHelper {
  constructor(private readonly ctx: LegalityContext) {}

  private get state() { return this.ctx.state; }
  private get me() { return this.ctx.me; }

  // --- pure lookups -------------------------------------------------------

  hexAt(c: Axial): Hex | undefined {
    return this.state?.hexes.find((h) => h.q === c.q && h.r === c.r);
  }

  blockadeById(id: string | null): Blockade | undefined {
    return id ? this.state?.blockades.find((b) => b.id === id) : undefined;
  }

  mePlayer(): Player | null {
    return this.me;
  }

  blockadeBetween(from: Axial, to: Axial): Blockade | undefined {
    return this.state?.blockades.find((blockade) => {
      const edges = blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
      return edges.some(
        (edge) =>
          (sameCoord(edge.a, from) && sameCoord(edge.b, to)) || (sameCoord(edge.b, from) && sameCoord(edge.a, to)),
      );
    });
  }

  blockadeEdges(blockade: Blockade): Array<{ a: Axial; b: Axial }> {
    return blockade.edges?.length ? blockade.edges : [{ a: blockade.a, b: blockade.b }];
  }

  blockadeDestination(blockade: Blockade, symbol?: MoveSymbol, power?: number): Hex | undefined {
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

  // --- movement legality --------------------------------------------------

  movementRequirement(
    hex: Hex,
  ): { required: MoveSymbol | null; cost: number; blockade?: Blockade; discard?: boolean; destReq?: MoveSymbol | null } {
    const me = this.me;
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

  canEnter(hex: Hex, symbol: MoveSymbol, power: number): boolean {
    const me = this.me;
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

  canStepToEldorado(hex: Hex): boolean {
    const me = this.me;
    if (!me || hex.terrain !== 'eldorado') return false;
    if (!isAdjacent(me.position, hex)) return false;
    const current = this.hexAt(me.position);
    if (!isFinishEntrance(current)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    return !blockade || !!blockade.claimedBy;
  }

  canUseNativeOn(hex: Hex): boolean {
    const me = this.me;
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

  canClearSpaceWithSelection(hex: Hex, selectedHandCardIds: string[]): boolean {
    const me = this.me;
    if (!me) return false;
    if (hex.terrain !== 'rubble' && hex.terrain !== 'basecamp') return false;
    if (!isAdjacent(me.position, hex)) return false;
    if (hex.occupant && hex.occupant !== me.id) return false;
    const blockade = this.blockadeBetween(me.position, hex);
    if (blockade && !blockade.claimedBy) return false;
    return selectedHandCardIds.length === hex.cost;
  }

  canRemoveBlockade(blockade: Blockade, symbol: MoveSymbol, power: number): boolean {
    return !blockade.claimedBy && !blockadeRequiresDiscard(blockade)
      && !!this.blockadeDestination(blockade)
      && blockadeMoveSymbol(blockade) === symbol && power >= blockade.cost;
  }
}
