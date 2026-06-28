import type { Axial, MoveSymbol } from './types.js';

/** Player intents the engine validates and applies. */
export type Action =
  | { type: 'PlayMovementCard'; cardId: string; symbol: MoveSymbol }
  | { type: 'StepTo'; to: Axial }
  | { type: 'ClearSpace'; to: Axial; cardIds: string[] }
  | { type: 'PromoteMarket'; defId: string }
  | { type: 'BuyCard'; defId: string; paymentCardIds: string[] }
  | { type: 'RemoveBlockade'; blockadeId: string; cardIds?: string[]; cardId?: string; symbol?: MoveSymbol }
  | { type: 'DiscardCards'; cardIds: string[] }
  | { type: 'RemoveCards'; cardIds: string[] }
  | {
      type: 'UseAbility';
      cardId: string;
      removeCardIds?: string[];
      takeDefId?: string;
      nativeTo?: Axial;
    }
  | { type: 'EndTurn' }
  | {
      /**
       * Play a cave token from the player's stash. The shape of `data`
       * depends on `tokenId`:
       *   - `move_*` tokens: `{ symbol: MoveSymbol; to: Axial }`. Plays
       *     like a movement card with the token's power; the chosen symbol
       *     must match the token's symbol (e.g. a `move_coin_2` token is
       *     played as a coin-2 card). Multiple steps consume remaining
       *     power like a normal movement card.
       *   - `coin_*` tokens: may also be used to buy via
       *     `{ kind: 'buy'; defId: string; paymentCardIds: string[] }`.
       *   - `draw_play`: `{ kind: 'draw_play' }` — draw 1 and play it
       *     this turn (handled inside the cave engine).
       *   - `remove_hand`: `{ kind: 'remove_hand'; cardId: string }`.
       *   - `swap_hand`: `{ kind: 'swap_hand'; cardIds: string[] }`.
       *   - `preserve_item`: `{ kind: 'preserve_item' }` — applies to the
       *     next single-use action card played this turn.
       *   - `pass_through`: `{ kind: 'pass_through' }` — applies for the
       *     rest of this turn.
       *   - `native`: `{ kind: 'native'; to: Axial }`.
       *   - `symbol_swap`: `{ kind: 'symbol_swap'; symbol: MoveSymbol;
       *     to: Axial }` — the next movement card (including a future
       *     PlayMovementCard) is treated as the chosen symbol.
       */
      type: 'PlayCaveToken';
      tokenId: string;
      data: PlayCaveTokenData;
    };

/** Payload for `PlayCaveToken`, discriminated per token effect. */
export type PlayCaveTokenData =
  | { kind: 'move'; symbol: MoveSymbol; to: Axial }
  | { kind: 'buy'; defId: string; paymentCardIds: string[] }
  | { kind: 'draw_play' }
  | { kind: 'remove_hand'; cardId: string }
  | { kind: 'swap_hand'; cardIds: string[] }
  | { kind: 'preserve_item' }
  | { kind: 'pass_through' }
  | { kind: 'native'; to: Axial }
  | { kind: 'symbol_swap'; symbol: MoveSymbol; to: Axial };

/** Events emitted by a successful action, for the client to animate. */
export type GameEvent =
  | { type: 'movedTo'; playerId: string; to: Axial }
  | { type: 'cardPlayed'; playerId: string; cardId: string }
  | { type: 'spaceCleared'; playerId: string; to: Axial; removed: boolean }
  | { type: 'marketPromoted'; playerId: string; defId: string }
  | { type: 'bought'; playerId: string; defId: string }
  | { type: 'discarded'; playerId: string; count: number }
  | { type: 'removedCards'; playerId: string; count: number }
  | { type: 'ability'; playerId: string; cardId: string }
  | { type: 'drew'; playerId: string; count: number }
  | { type: 'blockadeClaimed'; playerId: string; blockadeId: string }
  | { type: 'reachedEldorado'; playerId: string }
  | { type: 'turnStarted'; playerId: string }
  | { type: 'gameOver'; winnerId: string | null }
  | { type: 'caveTokenDrawn'; playerId: string; caveId: string; tokenId: string }
  | { type: 'caveTokenUsed'; playerId: string; tokenId: string };

export type ActionResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; error: string };
