import type { Axial, MoveSymbol } from './types.js';

/** Player intents the engine validates and applies. */
export type Action =
  | { type: 'PlayMovementCard'; cardId: string; symbol: MoveSymbol }
  | { type: 'StepTo'; to: Axial }
  | { type: 'ClearSpace'; to: Axial; cardIds: string[] }
  | { type: 'BuyCard'; defId: string; paymentCardIds: string[] }
  | {
      type: 'UseAbility';
      cardId: string;
      removeCardIds?: string[];
      takeDefId?: string;
      nativeTo?: Axial;
    }
  | { type: 'EndTurn'; discardCardIds?: string[] };

/** Events emitted by a successful action, for the client to animate. */
export type GameEvent =
  | { type: 'movedTo'; playerId: string; to: Axial }
  | { type: 'cardPlayed'; playerId: string; cardId: string }
  | { type: 'spaceCleared'; playerId: string; to: Axial; removed: boolean }
  | { type: 'bought'; playerId: string; defId: string }
  | { type: 'ability'; playerId: string; cardId: string }
  | { type: 'drew'; playerId: string; count: number }
  | { type: 'reachedEldorado'; playerId: string }
  | { type: 'turnStarted'; playerId: string }
  | { type: 'gameOver'; winnerId: string | null };

export type ActionResult =
  | { ok: true; events: GameEvent[] }
  | { ok: false; error: string };
