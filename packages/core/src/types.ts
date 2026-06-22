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
}

/** A market pile: copies of one card def. */
export interface MarketPile {
  defId: string;
  count: number;
  /** True if this pile is one of the 6 on-board buyable slots. */
  onBoard: boolean;
}

export type Phase = 'lobby' | 'playing' | 'finished';

/** Turn-in-progress scratch state for the current player. */
export interface TurnState {
  playerId: string;
  /** The currently-active movement card with leftover power, if any. */
  activeMover?: { cardId: string; symbol: MoveSymbol; remaining: number };
  /** Cards played this turn awaiting discard at end of turn. */
  inPlay: Card[];
  /** Cards removed from the game this turn (go to player's removed pile). */
  removedThisTurn: Card[];
  /** Optional hand-removal choice that must be resolved after an action draws cards. */
  pendingRemoval?: { sourceCardId: string; max: number };
  /** Whether the player has already bought a card this turn. */
  hasBought: boolean;
  /** Whether the player has used the discard skill at least once this turn. */
  hasDiscarded: boolean;
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
}
