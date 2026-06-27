/**
 * ai/market — picks a market pile to promote this turn given the player's
 * current coin pool and the route gap the planner found. Pure over the
 * state + numbers; no side effects.
 */
import type { GameState, MarketPile } from '../types.js';
import { coinValue, getDef, movableSymbols } from '../cards.js';
import { isNativeCard, type Need } from './helpers.js';

const MARKET_SLOTS = 6;

export function marketNeedsPromotion(state: GameState): boolean {
  const active = state.market.filter((m) => m.onBoard && m.count > 0).length;
  return active < MARKET_SLOTS && state.market.some((m) => !m.onBoard && m.count > 0);
}

export function matchesNeed(defId: string, need: Need): boolean {
  if (need.ability === 'native') return isNativeCard(defId);
  const d = getDef(defId);
  const syms = movableSymbols(d.defId);
  const ok = need.symbol === null ? syms.length > 0 : syms.includes(need.symbol);
  return ok && d.power >= need.cost;
}

function cheapestFirst(a: MarketPile, b: MarketPile): number {
  return getDef(a.defId).cost - getDef(b.defId).cost;
}

export function chooseMarketPromotion(state: GameState, coins: number, gap: Need | null): string | null {
  if (!marketNeedsPromotion(state)) return null;
  const reserve = state.market.filter((m) => !m.onBoard && m.count > 0);

  if (gap) {
    const useful = reserve.filter((m) => matchesNeed(m.defId, gap)).sort(cheapestFirst);
    const affordableUseful = useful.filter((m) => getDef(m.defId).cost <= coins);
    if (affordableUseful.length > 0) return affordableUseful[0].defId;
    if (useful.length > 0) return useful[0].defId;
  }

  const affordable = reserve.filter((m) => getDef(m.defId).cost <= coins);
  const econ = affordable
    .filter((m) => coinValue(m.defId) >= 1)
    .sort((a, b) => coinValue(b.defId) - coinValue(a.defId) || cheapestFirst(a, b));
  if (econ.length > 0) return econ[0].defId;

  const movement = affordable
    .filter((m) => movableSymbols(m.defId).length > 0)
    .sort(cheapestFirst);
  if (movement.length > 0) return movement[0].defId;

  return reserve.slice().sort(cheapestFirst)[0]?.defId ?? null;
}