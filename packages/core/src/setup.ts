import type { GameState, Player, PlayerColor, MarketPile, Hex } from './types.js';
import {
  STARTING_DECK,
  STARTING_MARKET_SLOTS,
  MARKET_DEF_IDS,
  MARKET_COPIES,
  HAND_SIZE,
} from './cards.js';
import type { Card } from './types.js';
import { getMap } from './maps/index.js';
import { shuffle } from './rng.js';
import { key } from './hex.js';

export interface PlayerSeed {
  id: string;
  name: string;
  color: PlayerColor;
  isAI?: boolean;
}

/** Create a fresh, ready-to-play game state. */
export function createGame(
  seeds: PlayerSeed[],
  mapId = 'classic',
  seed = 1,
): GameState {
  if (seeds.length < 2 || seeds.length > 4) {
    throw new Error('冲向黄金城支持 2–4 名玩家');
  }
  const map = getMap(mapId);
  if (seeds.length > map.startHexes.length) {
    throw new Error('起点地格不足，无法容纳所有玩家');
  }

  const hexes: Hex[] = map.hexes.map((h) => ({ ...h }));
  const blockades = map.blockades.map((b) => ({
    ...b,
    a: { ...b.a },
    b: { ...b.b },
    edges: (b.edges ?? [{ a: b.a, b: b.b }]).map((edge) => ({
      a: { ...edge.a },
      b: { ...edge.b },
    })),
  }));
  const hexByKey = new Map(hexes.map((h) => [key(h), h]));
  let rngState = seed;

  const players: Player[] = seeds.map((s, i) => {
    // Build and shuffle the starting deck with player-unique ids (clean defId).
    let deck: Card[] = STARTING_DECK.flatMap((entry) =>
      Array.from({ length: entry.count }, (_, i) => ({
        id: `${s.id}:${entry.defId}#${i}`,
        defId: entry.defId,
      })),
    );
    [deck, rngState] = shuffle(deck, rngState);
    const hand = deck.splice(0, HAND_SIZE);

    const start = map.startHexes[i];
    const startHex = hexByKey.get(key(start));
    if (startHex) startHex.occupant = s.id;

    return {
      id: s.id,
      name: s.name,
      color: s.color,
      isAI: !!s.isAI,
      deck,
      hand,
      discard: [],
      removed: [],
      position: { q: start.q, r: start.r },
      finished: false,
      finishedAt: null,
      claimedBlockades: [],
      blockades: 0,
    };
  });

  const market: MarketPile[] = MARKET_DEF_IDS.map((defId) => ({
    defId,
    count: MARKET_COPIES,
    onBoard: STARTING_MARKET_SLOTS.includes(defId),
  }));

  const firstPlayer = players[0];
  return {
    mapId,
    hexes,
    blockades,
    players,
    market,
    turnOrder: players.map((p) => p.id),
    currentPlayerIdx: 0,
    phase: 'playing',
    turnNumber: 1,
    turn: {
      playerId: firstPlayer.id,
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
    },
    finalRoundTriggeredBy: null,
    finalTurnsRemaining: null,
    winnerId: null,
    rngState,
  };
}
