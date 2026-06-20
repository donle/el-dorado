import type { MoveSymbol } from './types.js';
import { getDef, movableSymbols } from './cards.js';

/**
 * Among candidate hand cards, pick the least-wasteful one that can pay a single
 * movement step (symbol `req`, cost `deduct`). Caller should first try to reuse
 * the active mover (zero waste); call this only when a fresh card is needed.
 *
 * Order: single-symbol cards before jokers, then smallest sufficient power
 * (minimal overflow). Returns null when nothing can pay the step.
 */
export function pickHandMover(
  req: MoveSymbol | null,
  deduct: number,
  candidates: { id: string; defId: string }[],
): { cardId: string; symbol: MoveSymbol } | null {
  const usable = candidates.filter((c) => {
    const syms = movableSymbols(c.defId);
    if (syms.length === 0) return false;
    if (req !== null && !syms.includes(req)) return false;
    return getDef(c.defId).power >= deduct;
  });
  if (usable.length === 0) return null;
  usable.sort((a, b) => {
    const la = movableSymbols(a.defId).length;
    const lb = movableSymbols(b.defId).length;
    if (la !== lb) return la - lb; // single-symbol first
    return getDef(a.defId).power - getDef(b.defId).power; // least overflow
  });
  const chosen = usable[0];
  const symbol = req !== null ? req : movableSymbols(chosen.defId)[0];
  return { cardId: chosen.id, symbol };
}
