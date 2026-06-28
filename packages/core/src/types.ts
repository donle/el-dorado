/**
 * Core domain types for The Quest for El Dorado.
 *
 * The engine is a pure, deterministic reducer. Nothing here knows about
 * rendering or networking — these types are shared by server and client.
 */

/** The three movement symbols on cards / terrain. */
export type MoveSymbol = 'machete' | 'paddle' | 'coin';

/** Card categories. Movement cards carry a symbol; jokers pick one when played. */
export type CardKind = 'green' | 'blue' | 'yellow' | 'joker' | 'action';

/** Action-card abilities (a subset is implemented in the MVP). */
export type AbilityType =
  | 'draw2' // Cartographer: draw 2, playable this turn
  | 'draw1_remove1' // Scientist: draw 1, may remove 1 from hand
  | 'draw3' // Compass: draw 3 (single use)
  | 'draw2_remove2' // Travel Log: draw 2, remove up to 2 (single use)
  | 'take_free' // Transmitter: take any market card free (single use)
  | 'native'; // Native: step onto 1 adjacent hex ignoring requirements

/** Static definition of a card type (shared by its copies). */
export interface CardDef {
  defId: string;
  name: string;
  kind: CardKind;
  /** Movement symbol for green/blue/yellow basic + market cards. */
  symbol?: MoveSymbol;
  /** Movement power (and joker value). Action cards use 0. */
  power: number;
  /** Purchase cost in coins. Starting cards are 0 (not buyable). */
  cost: number;
  /** True if the card is removed from the game after its ability is used. */
  singleUse?: boolean;
  ability?: AbilityType;
  /** Starting-deck cards are not sold in the market. */
  starting?: boolean;
}

/** A concrete card instance owned by a player. */
export interface Card {
  /** Unique instance id, e.g. "explorer#3". */
  id: string;
  defId: string;
}

/** Terrain a hex can be. */
export type Terrain =
  | 'green' // jungle — needs machete
  | 'blue' // water — needs paddle
  | 'yellow' // village — needs coin
  | 'rubble' // pay N any-cards (to discard)
  | 'basecamp' // pay N any-cards (removed from game)
  | 'mountain' // impassable
  | 'eldorado' // the golden city beyond the entrance — entering it finishes
  | 'start'
  | 'finish'; // El Dorado entrance hex

/** Axial hex coordinate (pointy-top). */
export interface Axial {
  q: number;
  r: number;
}

export interface Hex {
  q: number;
  r: number;
  terrain: Terrain;
  /** Power/count required to enter (1–4). 0 for start/mountain. */
  cost: number;
  /**
   * Required movement symbol to enter. Undefined = use the terrain's default
   * symbol, or wildcard for special legacy terrain.
   */
  reqSymbol?: MoveSymbol;
  /** True for the three terrain entrance hexes adjacent to El Dorado. */
  finishEntrance?: boolean;
  /** Player id occupying this hex, if any. */
  occupant?: string;
  /** Index of a start hex (1–4) or finish hex, for setup/ordering. */
  slot?: number;
  /**
   * True if this mountain hex bears a cave-entrance icon (Caves variant).
   * Mountain hexes are normally impassable; a cave hex still cannot be
   * entered, but tokens may be drawn from it by stopping adjacent.
   */
  cave?: boolean;
  /** Stable id of this cave's token pile; set when `cave` is true. */
  caveId?: string;
}

export interface BlockadeEdge {
  a: Axial;
  b: Axial;
}

export interface Blockade {
  /** Stable marker id, used by players' claimedBlockades for tie-breakers. */
  id: string;
  /** Representative crossing on one side of the continent seam. */
  a: Axial;
  /** Representative crossing on the opposite side of the continent seam. */
  b: Axial;
  /** Every adjacent hex-edge crossing covered by this Z-shaped seam terrain. */
  edges: BlockadeEdge[];
  /** Visual terrain texture for this seam plate. */
  terrain: Terrain;
  /** Movement resource required by green/blue/yellow blockades; rubble uses card discard instead. */
  symbol?: MoveSymbol;
  /** Movement power or discarded-card count required to claim and cross it. */
  cost: number;
  /** Player id of the first player who crossed it. Undefined while unclaimed. */
  claimedBy?: string;
}

export interface GameMap {
  id: string;
  name: string;
  hexes: Hex[];
  /** Zig-zag seam markers between continent tiles. */
  blockades: Blockade[];
  /** Coordinates of the start hexes, ordered by slot. */
  startHexes: Axial[];
  /** Coordinates of the El Dorado entrance hexes. */
  finishHexes: Axial[];
}

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';

export interface Player {
  id: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  /** True when a human left and the server AI is controlling this seat. */
  offline?: boolean;
  /** Draw pile (top of deck is index 0). */
  deck: Card[];
  hand: Card[];
  discard: Card[];
  /** Cards permanently removed from the game (basecamp / abilities). */
  removed: Card[];
  /** Current hex of the player's single piece (MVP: one piece each). */
  position: Axial;
  /** Whether the piece has reached El Dorado. */
  finished: boolean;
  /** Turn number on which the player finished (tie-breaker: earlier wins). */
  finishedAt: number | null;
  /** Stable ids of seam blockades claimed by this player. */
  claimedBlockades: string[];
  /** Number of blockades collected (tie-breaker). */
  blockades: number;
  /** Cave token ids held by this player (Caves variant). */
  caveTokens: string[];
  /**
   * Cave id whose token was just drawn into `caveTokens`. Used to enforce
   * the "leave the cave and return" anti-loop rule. `null` when not next
   * to any cave.
   */
  lastCaveId: string | null;
}

/** A market pile: copies of one card def. */
export interface MarketPile {
  defId: string;
  count: number;
  /** True if this pile is one of the 6 on-board buyable slots. */
  onBoard: boolean;
}

/**
 * Effect category of a cave token. The 36-token pool is partitioned into
 * eight kinds; the official rulebook counts are mirrored in `cave.ts`.
 *
 * - `move_<sym>_<n>`: play as a movement card with symbol/symbol and power n.
 *   `coin` tokens may also be used to buy a market card.
 * - `draw_play`: draw 1 extra card from the deck and play it this turn
 *   (Cartographer-style immediate use).
 * - `remove_hand`: permanently remove any one card from hand.
 * - `swap_hand`: exchange 1–4 hand cards for the same number drawn from the
 *   deck (Travel Log-style).
 * - `preserve_item`: after using a single-use action card this turn, send
 *   it to the discard pile instead of removing it from the game.
 * - `pass_through`: for the rest of the turn, moving through or onto a hex
 *   occupied by another player is allowed (mountains still block).
 * - `native`: move to any adjacent hex ignoring its requirements (same as
 *   the Native card's ability).
 * - `symbol_swap`: change the symbol of the next movement card you play
 *   (e.g. use a machete-3 as coin-3 or paddle-3).
 */
export type CaveTokenKind =
  | 'move_machete_1'
  | 'move_machete_2'
  | 'move_machete_3'
  | 'move_coin_1'
  | 'move_coin_2'
  | 'move_coin_3'
  | 'move_paddle_1'
  | 'move_paddle_2'
  | 'move_paddle_3'
  | 'draw_play'
  | 'remove_hand'
  | 'swap_hand'
  | 'preserve_item'
  | 'pass_through'
  | 'native'
  | 'symbol_swap';

/** A single cave token instance. */
export interface CaveToken {
  /** Stable id, e.g. `cave#m2-3`. */
  id: string;
  kind: CaveTokenKind;
  /** Movement power for `move_*` kinds; 0 for non-movement kinds. */
  power: number;
  /** For `move_*` kinds: the symbol the token plays as. */
  symbol?: MoveSymbol;
  /** Chinese display name. */
  name: string;
}

export type Phase = 'lobby' | 'playing' | 'finished';

/**
 * P1 字符串收敛常量
 * 单一来源：所有封闭字符串集合在此集中定义。
 * @see docs/VOCAB.md
 * @see docs/adr/0001-types-and-naming.md
 */

/** Client-side UI phase overlay (extends `Phase` for countdown UI state). */
export const UI_PHASES = ['lobby', 'countdown', 'playing', 'finished'] as const;
export type UIPhase = typeof UI_PHASES[number];

/** WebSocket connection state. */
export const CONNECTION_STATES = ['connecting', 'open', 'closing', 'closed'] as const;
export type ConnectionState = typeof CONNECTION_STATES[number];

/** Server-side room lifecycle (orthogonal to client UI phase). */
export const ROOM_STATUSES = ['waiting', 'starting', 'playing', 'finished'] as const;
export type RoomStatus = typeof ROOM_STATUSES[number];

/** Asset preload categories. */
export const ASSET_CATEGORIES = [
  'terrain', 'card', 'card-icon', 'ui', 'icon', 'pwa',
] as const;
export type AssetCategory = typeof ASSET_CATEGORIES[number];

/** Application-level error codes. */
export const ERROR_CODES = [
  'INVALID_ACTION', 'NOT_YOUR_TURN', 'ROOM_NOT_FOUND', 'ROOM_FULL',
  'PROTOCOL_ERROR', 'INTERNAL', 'ASSET_LOAD_FAILED', 'CONNECTION_LOST',
  'RECONNECT_FAILED', 'AI_DISABLED',
] as const;
export type ErrorCode = typeof ERROR_CODES[number];

/** Turn-in-progress scratch state for the current player. */
export interface TurnState {
  playerId: string;
  /** The currently-active movement card with leftover power, if any. */
  activeMover?: {
    cardId: string;
    symbol: MoveSymbol;
    remaining: number;
    /** True when the mover was created by a cave token (no hand card). */
    fromCave?: boolean;
  };
  /** Cards played this turn awaiting discard at end of turn. */
  inPlay: Card[];
  /** Cards removed from the game this turn (go to player's removed pile). */
  removedThisTurn: Card[];
  /** Optional hand-removal choice that must be resolved after an action draws cards. */
  pendingRemoval?: { sourceCardId: string; max: number };
  /** Optional hand-trim requirement to resolve at end of turn (hand → ≤ max). */
  pendingTrim?: { max: number };
  /** Whether the player has already bought a card this turn. */
  hasBought: boolean;
  /** Whether the player has used the discard skill at least once this turn. */
  hasDiscarded: boolean;
  /** Cave token `draw_play` armed: drawn card must be played this turn. */
  drawPlayTokenActive?: boolean;
  /** Cave token `preserve_item` armed: next single-use action goes to discard. */
  preserveItemActive?: boolean;
  /** Cave token `pass_through` armed: can pass through occupied hexes this turn. */
  passThroughActive?: boolean;
  /** Cave token `symbol_swap` armed: next movement card uses this symbol. */
  symbolSwap?: MoveSymbol;
}

export interface GameState {
  mapId: string;
  hexes: Hex[];
  blockades: Blockade[];
  players: Player[];
  market: MarketPile[];
  /** Player ids in turn order. */
  turnOrder: string[];
  /** Index into turnOrder of the current player. */
  currentPlayerIdx: number;
  phase: Phase;
  turn: TurnState | null;
  /** Global turn counter, incremented at the start of each turn. */
  turnNumber: number;
  /** Set once someone reaches El Dorado: the final round is in progress. */
  finalRoundTriggeredBy: string | null;
  /** Remaining final turns for the other players; null until triggered. */
  finalTurnsRemaining: number | null;
  winnerId: string | null;
  /** Seed state for deterministic shuffles. */
  rngState: number;
  /**
   * Per-cave face-down token pile, keyed by stable cave id (e.g. `cave-1`).
   * The first id in the array is the top of the pile. The Caves variant
   * uses 4 tokens per cave; clients use this list length to render a stack.
   */
  cavePiles: Record<string, string[]>;
  /**
   * Per-player cave token stash, keyed by player id. The player's own
   * `CaveToken` ids; tokens removed after use never re-enter any pile.
   */
  playerCaveTokens: Record<string, string[]>;
  /**
   * Per-player anti-loop marker: id of the cave the player last explored
   * (`null` when the player is not currently next to a cave). Used to
   * prevent re-drawing from the same cave without first stepping away.
   */
  lastExploredCave: Record<string, string | null>;
}
