/**
 * Glyph + label maps for `MoveSymbol` icons and `CardKind` icons.
 *
 * P1: these are typed as `Record<MoveSymbol, string>` / `Record<CardKind, string>`
 * so adding a new value to the source union forces a compile error here,
 * preventing stale or missing entries.
 */
import type { CardKind, MoveSymbol } from '@eldorado/core';

/** Single-character glyph rendered for a move symbol (machete, paddle, coin). */
export const SYMBOL_GLYPH: Record<MoveSymbol, string> = {
  machete: '🗡️',
  paddle: '🛶',
  coin: '🪙',
};

/** Localised label for each move symbol. */
export const SYMBOL_LABEL: Record<MoveSymbol, string> = {
  machete: '砍刀',
  paddle: '船桨',
  coin: '金币',
};

/** Localised label for each card kind (used by hand panel + card preview). */
export const KIND_LABEL: Record<CardKind, string> = {
  green: '丛林 · 砍刀',
  blue: '水域 · 船桨',
  yellow: '村庄 · 金币',
  joker: '万能牌',
  action: '行动牌',
};