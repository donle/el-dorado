/**
 * Pure terrain / movement helpers (Stage E extraction).
 *
 * Originally inlined in the client (`main.ts` + `controllers/InteractionController.ts`)
 * and as private copies in `engine.ts` / `ai.ts`. Moved here so a single
 * implementation is shared by client rendering, server validation, and AI.
 * All are deterministic, side-effect free, and easy to unit-test.
 */
import type { Axial, Blockade, GameState, Hex, MoveSymbol, Terrain } from './types.js';

/** Symbol a movement card must match to enter a terrain (null = wildcard). */
export function terrainSymbol(t: Terrain): MoveSymbol | null {
  switch (t) {
    case 'green':
      return 'machete';
    case 'blue':
      return 'paddle';
    case 'yellow':
      return 'coin';
    default:
      // start / finish are wildcard; mountain/rubble/basecamp handled elsewhere
      return null;
  }
}

/** Symbol a blockade demands, derived from its terrain or explicit `.symbol`. */
export function blockadeMoveSymbol(blockade: Blockade): MoveSymbol | null {
  return terrainSymbol(blockade.terrain) ?? blockade.symbol ?? null;
}

/** A blockade that forces a discard (rubble or has no usable move symbol). */
export function blockadeRequiresDiscard(blockade: Blockade): boolean {
  return blockade.terrain === 'rubble' || blockadeMoveSymbol(blockade) === null;
}

/** True for a "finish" hex or any cell flagged as a finish-entrance. */
export function isFinishEntrance(hex: Hex | null | undefined): boolean {
  return !!hex && (hex.finishEntrance === true || hex.terrain === 'finish');
}

/** Symbol a hex demands to enter (null = any / no movement needed). */
export function requiredFor(hex: Hex): MoveSymbol | null {
  if (hex.terrain === 'finish') return hex.reqSymbol ?? null;
  if (hex.reqSymbol) return hex.reqSymbol;
  return terrainSymbol(hex.terrain);
}

/** Power a single step onto this hex costs. */
export function stepCost(hex: Hex): number {
  if (hex.terrain === 'start') return 1;
  if (hex.terrain === 'eldorado') return 0;
  if (hex.terrain === 'finish') return Math.max(hex.cost, 1);
  return hex.cost;
}

/** Axial coordinate equality. */
export function sameCoord(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

/** defId for a given cardId — looks at all the player's piles + the active turn,
 *  with a regex-based fallback for cardIds that embed their defId in the format
 *  `playerId:defId#n`. */
export function cardDefId(cardId: string, state: GameState): string {
  return findCardDefId(cardId, state) ?? fallbackCardDefId(cardId);
}

export function findCardDefId(cardId: string, state: GameState): string | null {
  for (const p of state.players) {
    const c = [...p.hand, ...p.deck, ...p.discard, ...p.removed].find((x) => x.id === cardId);
    if (c) return c.defId;
  }
  const turnCard = [...(state.turn?.inPlay ?? []), ...(state.turn?.removedThisTurn ?? [])].find(
    (x) => x.id === cardId,
  );
  if (turnCard) return turnCard.defId;
  return null;
}

export function fallbackCardDefId(cardId: string): string {
  // ids look like "playerId:defId#n"
  const m = cardId.match(/:([^:#]+)#/);
  return m ? m[1] : cardId;
}
