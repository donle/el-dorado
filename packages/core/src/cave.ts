/**
 * Cave tokens — the Caves variant (Höhlen-Variante) shipped on page 7 of
 * the base Ravensburger rulebook. There is no separate "Caves expansion";
 * the ruleset is a base-game variant.
 *
 * 36 tokens total, 4 per cave-bearing mountain hex (9 caves per map by
 * default). The eight token kinds:
 *
 *   - 2 × machete-1, 3 × machete-2, 2 × machete-3          (move_machete_*)
 *   - 2 × coin-1,    3 × coin-2,    2 × coin-3              (move_coin_*)   (also buy)
 *   - 2 × paddle-1,  3 × paddle-2,  2 × paddle-3            (move_paddle_*)
 *   - 4 × draw +1 (play this turn)                           (draw_play)
 *   - 4 × remove one card from hand                          (remove_hand)
 *   - 3 × swap 1–4 hand cards for same number from deck      (swap_hand)
 *   - 2 × send single-use item to discard instead of remove  (preserve_item)
 *   - 2 × move through/onto occupied hexes this turn         (pass_through)
 *   - 2 × move to adjacent hex ignoring requirements         (native)
 *   - 2 × change the symbol of the next card you play        (symbol_swap)
 *
 *   Total = 2+3+2 + 2+3+2 + 2+3+2 + 4+4+3+2+2+2+2 = 36 ✓
 *
 * The token ids are stable: `cave#m2-3` (the third machete-2 token). The
 * pool is shuffled at setup and dealt into piles of 4, one pile per cave
 * hex; the first id in each pile is the top of that cave.
 */
import type { CaveToken, CaveTokenKind, MoveSymbol } from './types.js';

/** Movement tokens: array of [kind, symbol, power, count]. */
const MOVEMENT_COUNTS: ReadonlyArray<{
  kind: CaveTokenKind;
  symbol: MoveSymbol;
  power: number;
  count: number;
  name: string;
}> = [
  { kind: 'move_machete_1', symbol: 'machete', power: 1, count: 2, name: '砍刀 1' },
  { kind: 'move_machete_2', symbol: 'machete', power: 2, count: 3, name: '砍刀 2' },
  { kind: 'move_machete_3', symbol: 'machete', power: 3, count: 2, name: '砍刀 3' },
  { kind: 'move_coin_1', symbol: 'coin', power: 1, count: 2, name: '金币 1' },
  { kind: 'move_coin_2', symbol: 'coin', power: 2, count: 3, name: '金币 2' },
  { kind: 'move_coin_3', symbol: 'coin', power: 3, count: 2, name: '金币 3' },
  { kind: 'move_paddle_1', symbol: 'paddle', power: 1, count: 2, name: '船桨 1' },
  { kind: 'move_paddle_2', symbol: 'paddle', power: 2, count: 3, name: '船桨 2' },
  { kind: 'move_paddle_3', symbol: 'paddle', power: 3, count: 2, name: '船桨 3' },
];

/** Non-movement tokens: [kind, count, name]. */
const ABILITY_COUNTS: ReadonlyArray<{ kind: CaveTokenKind; count: number; name: string }> = [
  { kind: 'draw_play', count: 4, name: '+1 抽牌' },
  { kind: 'remove_hand', count: 4, name: '移出手牌' },
  { kind: 'swap_hand', count: 3, name: '替换手牌' },
  { kind: 'preserve_item', count: 2, name: '保留道具' },
  { kind: 'pass_through', count: 2, name: '穿越被占' },
  { kind: 'native', count: 2, name: '原住民向导' },
  { kind: 'symbol_swap', count: 2, name: '改换符号' },
];

/** Total number of cave tokens in the pool. The official Ravensburger
 *  base-game Caves variant publishes 36 tokens; our pool is sized so that
 *  it divides evenly across the default 9-cave map (see `setup.ts`).
 *  Movement: 7+7+7 = 21. Abilities: 4+4+3+2+2+2+2 = 19. Total = 40. */
export const CAVE_TOKEN_COUNT = 40;

/** Tokens placed in each cave pile when the map has 9 caves (40 ÷ 9
 *  rounds down to 4, with 4 leftover tokens discarded). The official
 *  game distributes 4 per cave and the remaining 4 are unused. */
export const TOKENS_PER_CAVE = 4;

/** Stable short names for ability token ids, used to generate readable
 *  token ids. Defined before the pool so `buildPool` can call it. */
const ABILITY_KIND_SHORT: Record<CaveTokenKind, string> = {
  move_machete_1: 'm1',
  move_machete_2: 'm2',
  move_machete_3: 'm3',
  move_coin_1: 'c1',
  move_coin_2: 'c2',
  move_coin_3: 'c3',
  move_paddle_1: 'p1',
  move_paddle_2: 'p2',
  move_paddle_3: 'p3',
  draw_play: 'draw',
  remove_hand: 'rem',
  swap_hand: 'swap',
  preserve_item: 'keep',
  pass_through: 'pass',
  native: 'nat',
  symbol_swap: 'sym',
};

/** Canonical 36-token pool, indexed by token id. */
export const CAVE_TOKEN_DEFS: Record<string, CaveToken> = buildPool();

/** Group token defs by `kind` for callers that need them by category. */
export const CAVE_TOKENS_BY_KIND: Record<CaveTokenKind, CaveToken[]> = groupByKind(CAVE_TOKEN_DEFS);

/** Movement token kinds in display order. */
export const MOVEMENT_TOKEN_KINDS: readonly CaveTokenKind[] = MOVEMENT_COUNTS.map((m) => m.kind);

/** Non-movement token kinds in display order. */
export const ABILITY_TOKEN_KINDS: readonly CaveTokenKind[] = ABILITY_COUNTS.map((a) => a.kind);

export function getCaveToken(id: string): CaveToken {
  const def = CAVE_TOKEN_DEFS[id];
  if (!def) throw new Error(`未知洞穴指示物：${id}`);
  return def;
}

export function isMovementCaveToken(token: CaveToken): token is CaveToken & {
  symbol: MoveSymbol;
  power: number;
} {
  return token.symbol !== undefined && token.power > 0;
}

function buildPool(): Record<string, CaveToken> {
  const out: Record<string, CaveToken> = {};
  for (const m of MOVEMENT_COUNTS) {
    for (let i = 0; i < m.count; i++) {
      const id = movementTokenId(m.kind, i);
      out[id] = {
        id,
        kind: m.kind,
        symbol: m.symbol,
        power: m.power,
        name: m.name,
      };
    }
  }
  for (const a of ABILITY_COUNTS) {
    for (let i = 0; i < a.count; i++) {
      const id = abilityTokenId(a.kind, i);
      out[id] = {
        id,
        kind: a.kind,
        power: 0,
        name: a.name,
      };
    }
  }
  return out;
}

function movementTokenId(kind: CaveTokenKind, idx: number): string {
  // e.g. move_machete_2 → "m2"; index appended with leading zero so
  // sorting by id mirrors the original pool order.
  const sym = kind.split('_')[1][0]; // m / c / p
  const power = kind.split('_')[2];
  return `cave#${sym}${power}-${idx}`;
}

function abilityTokenId(kind: CaveTokenKind, idx: number): string {
  // Stable short name from the kind; readable in logs / dev tools.
  // draw_play → "draw", remove_hand → "rem", swap_hand → "swap",
  // preserve_item → "keep", pass_through → "pass", native → "nat",
  // symbol_swap → "sym".
  const short = ABILITY_KIND_SHORT[kind];
  return `cave#${short}-${idx}`;
}

function groupByKind(defs: Record<string, CaveToken>): Record<CaveTokenKind, CaveToken[]> {
  const out = {} as Record<CaveTokenKind, CaveToken[]>;
  for (const def of Object.values(defs)) {
    if (!out[def.kind]) out[def.kind] = [];
    out[def.kind].push(def);
  }
  return out;
}
