import type { GameState, Player, PlayerColor, MarketPile, Hex } from './types.js';
import {
  STARTING_DECK,
  STARTING_MARKET_SLOTS,
  MARKET_DEF_IDS,
  MARKET_COPIES,
  HAND_SIZE,
} from './cards.js';
import { CAVE_TOKEN_DEFS, CAVE_TOKEN_COUNT, TOKENS_PER_CAVE } from './cave.js';
import type { Card } from './types.js';
import { getMap } from './maps/index.js';
import { shuffle } from './rng.js';
import { key } from './hex.js';

export interface PlayerSeed {
  id: string;
  name: string;
  color: PlayerColor;
  isAI?: boolean;
  offline?: boolean;
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

  const playerBases: Array<Omit<Player, 'position'>> = seeds.map((s) => {
    // Build and shuffle the starting deck with player-unique ids (clean defId).
    let deck: Card[] = STARTING_DECK.flatMap((entry) =>
      Array.from({ length: entry.count }, (_, i) => ({
        id: `${s.id}:${entry.defId}#${i}`,
        defId: entry.defId,
      })),
    );
    [deck, rngState] = shuffle(deck, rngState);
    const hand = deck.splice(0, HAND_SIZE);

    return {
      id: s.id,
      name: s.name,
      color: s.color,
      isAI: !!s.isAI,
      offline: !!s.offline,
      deck,
      hand,
      discard: [],
      removed: [],
      finished: false,
      finishedAt: null,
      claimedBlockades: [],
      blockades: 0,
      caveTokens: [],
      lastCaveId: null,
    };
  });
  const eligibleStarts = map.startHexes.slice(0, seeds.length);
  const [shuffledStarts, nextRngState] = shuffle(eligibleStarts, rngState);
  rngState = nextRngState;

  const players: Player[] = playerBases.map((p, i) => {
    const start = shuffledStarts[i];
    const startHex = hexByKey.get(key(start));
    if (startHex) startHex.occupant = p.id;
    return {
      ...p,
      position: { q: start.q, r: start.r },
    };
  });

  const market: MarketPile[] = MARKET_DEF_IDS.map((defId) => ({
    defId,
    count: MARKET_COPIES,
    onBoard: STARTING_MARKET_SLOTS.includes(defId),
  }));

  // Caves variant: identify cave-bearing hexes (mountain + cave flag),
  // shuffle the 36-token pool, deal 4 tokens per cave as a face-down pile.
  // If the map has fewer or more caves than the 36-token pool expects, we
  // honour the map count: the official game has 9 caves, but custom routes
  // may add or remove cave cells in the plate JSON.
  const caveHexes = hexes.filter((h) => h.terrain === 'mountain' && h.cave);
  let allTokenIds = Object.keys(CAVE_TOKEN_DEFS);
  if (allTokenIds.length !== CAVE_TOKEN_COUNT) {
    throw new Error(`洞穴 token 池数量错误：期望 ${CAVE_TOKEN_COUNT}，实为 ${allTokenIds.length}`);
  }
  const expectedPerCave = Math.max(1, Math.floor(allTokenIds.length / Math.max(1, caveHexes.length)));
  if (expectedPerCave !== TOKENS_PER_CAVE) {
    // Map has a different cave count than 9. Trim/extend the pool so each
    // cave gets the same number of tokens without leaving leftovers. The
    // official game always has 9 caves × 4 tokens = 36; this branch only
    // triggers for custom plates.
    allTokenIds = allTokenIds.slice(0, expectedPerCave * caveHexes.length);
  }
  let shuffledTokens: string[];
  [shuffledTokens, rngState] = shuffle(allTokenIds, rngState);

  const cavePiles: Record<string, string[]> = {};
  for (let i = 0; i < caveHexes.length; i++) {
    const pile = shuffledTokens.slice(i * expectedPerCave, (i + 1) * expectedPerCave);
    const caveId = `cave-${i + 1}`;
    const hex = caveHexes[i];
    hex.caveId = caveId;
    cavePiles[caveId] = pile;
  }
  const playerCaveTokens: Record<string, string[]> = {};
  const lastExploredCave: Record<string, string | null> = {};
  for (const p of seeds) {
    playerCaveTokens[p.id] = [];
    lastExploredCave[p.id] = null;
  }

  const startRank = new Map(map.startHexes.map((c, i) => [key(c), i]));
  const turnOrder = players
    .slice()
    .sort((a, b) => (startRank.get(key(a.position)) ?? Infinity) - (startRank.get(key(b.position)) ?? Infinity))
    .map((p) => p.id);
  const firstPlayer = players.find((p) => p.id === turnOrder[0]) ?? players[0];
  return {
    mapId,
    hexes,
    blockades,
    players,
    market,
    turnOrder,
    currentPlayerIdx: 0,
    phase: 'playing',
    turnNumber: 1,
    turn: {
      playerId: firstPlayer.id,
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
      hasDiscarded: false,
    },
    finalRoundTriggeredBy: null,
    finalTurnsRemaining: null,
    winnerId: null,
    rngState,
    cavePiles,
    playerCaveTokens,
    lastExploredCave,
  };
}
