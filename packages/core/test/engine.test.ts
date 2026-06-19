import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/engine.js';
import { isAdjacent, key, neighbors } from '../src/hex.js';
import type { GameState, Axial, Card, Hex, MoveSymbol, Terrain, Blockade } from '../src/types.js';
import type { Action } from '../src/actions.js';

function game(players = 2): GameState {
  const seeds = [
    { id: 'p0', name: 'A', color: 'red' as const },
    { id: 'p1', name: 'B', color: 'blue' as const },
    { id: 'p2', name: 'C', color: 'green' as const },
    { id: 'p3', name: 'D', color: 'yellow' as const },
  ].slice(0, players);
  return createGame(seeds, 'corridor', 42);
}

function giveHand(s: GameState, pid: string, defs: string[]): void {
  const p = s.players.find((x) => x.id === pid)!;
  p.hand = defs.map((d, i): Card => ({ id: `${pid}:${d}#t${i}`, defId: d }));
}

function placeAt(s: GameState, pid: string, c: Axial): void {
  const p = s.players.find((x) => x.id === pid)!;
  const old = s.hexes.find((h) => h.q === p.position.q && h.r === p.position.r);
  if (old) old.occupant = undefined;
  p.position = { ...c };
  const h = s.hexes.find((h) => h.q === c.q && h.r === c.r);
  if (h) h.occupant = pid;
}

function setTurn(s: GameState, pid: string): void {
  const idx = s.turnOrder.indexOf(pid);
  if (idx === -1) throw new Error(`Unknown player ${pid}`);
  s.currentPlayerIdx = idx;
  s.turnNumber += idx;
  s.turn = {
    playerId: pid,
    inPlay: [],
    removedThisTurn: [],
    hasBought: false,
  };
}

function run(s: GameState, pid: string, ...actions: Action[]) {
  let state = s;
  let last;
  for (const a of actions) {
    const r = applyAction(state, pid, a);
    state = r.state;
    last = r.result;
  }
  return { state, result: last! };
}

const pos = (s: GameState, pid: string) => s.players.find((p) => p.id === pid)!.position;

const BASIC_CARD_BY_SYMBOL = {
  machete: 'explorer',
  paddle: 'sailor',
  coin: 'traveller',
} as const;

const STRONG_CARD_BY_SYMBOL: Record<MoveSymbol, string> = {
  machete: 'pioneer',
  paddle: 'captain',
  coin: 'millionaire',
};

function terrainSymbolForTest(terrain: Terrain): MoveSymbol | null {
  if (terrain === 'green') return 'machete';
  if (terrain === 'blue') return 'paddle';
  if (terrain === 'yellow') return 'coin';
  return null;
}

function blockadeSymbolForTest(blockade: Blockade): MoveSymbol {
  const symbol = terrainSymbolForTest(blockade.terrain) ?? blockade.symbol;
  if (!symbol) throw new Error(`Blockade ${blockade.id} does not require movement`);
  return symbol;
}

function otherSymbol(symbol: keyof typeof BASIC_CARD_BY_SYMBOL): keyof typeof BASIC_CARD_BY_SYMBOL {
  return symbol === 'machete' ? 'paddle' : 'machete';
}

function cubeDistTest(a: Axial, b: Axial): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/** A covered seam edge crossed start→end; `wantCompatible` filters whether the
 *  destination terrain accepts the seam's own symbol. */
function seamCrossing(
  s: GameState,
  blockade: Blockade,
  wantCompatible: boolean,
): { from: Axial; to: Axial; dest: Hex } | null {
  const start = s.hexes.find((h) => h.terrain === 'start')!;
  const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
  const seamSym = terrainSymbolForTest(blockade.terrain) ?? blockade.symbol ?? null;
  for (const e of blockade.edges) {
    const toIsB = cubeDistTest(e.b, start) >= cubeDistTest(e.a, start);
    const from = toIsB ? e.a : e.b;
    const to = toIsB ? e.b : e.a;
    const dest = hexAt(to);
    if (dest.terrain === 'mountain' || dest.terrain === 'rubble' || dest.terrain === 'basecamp') continue;
    const destSym = terrainSymbolForTest(dest.terrain);
    const compatible = destSym === null || destSym === seamSym;
    if (compatible === wantCompatible) return { from, to, dest };
  }
  return null;
}

describe('setup', () => {
  it('deals 4 cards and places pieces on start hexes', () => {
    const s = game(2);
    expect(s.players[0].hand).toHaveLength(4);
    expect(s.players[0].deck).toHaveLength(4); // 8 - 4
    const slot1 = s.hexes.find((h) => h.slot === 1 && h.terrain === 'start')!;
    expect(s.players[0].position).toEqual({ q: slot1.q, r: slot1.r });
    const startOccupied = s.hexes.filter((h) => h.terrain === 'start' && h.occupant);
    expect(startOccupied).toHaveLength(2);
  });
});

describe('movement', () => {
  it('moves through a matching hex and keeps leftover power', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 }); // green1
    giveHand(s, 'p0', ['scout']); // machete 2
    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:scout#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } }, // green2 → uses all 2
    );
    expect(result.ok).toBe(true);
    expect(pos(state, 'p0')).toEqual({ q: 3, r: 0 });
    expect(state.turn!.activeMover!.remaining).toBe(0);
  });

  it('cannot combine two weak cards to enter one strong hex', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 });
    giveHand(s, 'p0', ['explorer', 'explorer']); // machete 1 each
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:explorer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } }, // green2 needs power 2
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a symbol mismatch', () => {
    const s = game();
    placeAt(s, 'p0', { q: 3, r: 0 }); // green2
    giveHand(s, 'p0', ['explorer']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:explorer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 4, r: 0 } }, // blue1
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/船桨/);
  });

  it('cannot enter a mountain', () => {
    const s = game();
    placeAt(s, 'p0', { q: 10, r: 0 }); // blue3 next to mountain (10,1)
    giveHand(s, 'p0', ['pioneer']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 10, r: 1 } },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/山地/);
  });

  it('cannot enter El Dorado before reaching an entrance', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      7,
    );
    const city = s.hexes.filter((h) => h.terrain === 'eldorado');
    expect(city.length).toBeGreaterThan(0);

    const target = city[0];
    const stand = neighbors(target).find((n) => {
      const h = s.hexes.find((x) => x.q === n.q && x.r === n.r);
      return h?.terrain !== 'finish';
    })!;

    placeAt(s, 'p0', stand);
    giveHand(s, 'p0', ['pioneer']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: target.q, r: target.r } },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/黄金城入口/);
  });

  it('cannot enter an occupied hex', () => {
    const s = game();
    placeAt(s, 'p0', { q: 2, r: 0 });
    placeAt(s, 'p1', { q: 3, r: 0 });
    giveHand(s, 'p0', ['scout']);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:scout#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 3, r: 0 } },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/占用/);
  });

  it('joker can move as any symbol', () => {
    const s = game();
    placeAt(s, 'p0', { q: 3, r: 0 }); // green2
    giveHand(s, 'p0', ['adventurer']); // joker 2
    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:adventurer#t0', symbol: 'paddle' },
      { type: 'StepTo', to: { q: 4, r: 0 } }, // blue1
    );
    expect(result.ok).toBe(true);
    expect(pos(state, 'p0')).toEqual({ q: 4, r: 0 });
  });

  it('claims an unclaimed seam blockade for the first player who crosses it', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);

    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'StepTo', to: crossing.to },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(state.blockades[0].claimedBy).toBe('p0');
    expect(state.players[0].claimedBlockades).toEqual([blockade.id]);
    expect(state.players[0].blockades).toBe(1);
    expect(result.events).toContainEqual({ type: 'blockadeClaimed', playerId: 'p0', blockadeId: blockade.id });
  });

  it('claims the same blockade when crossing any covered seam edge', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    // A compatible crossing that is not the blockade's representative edge,
    // proving any covered seam edge claims the same marker.
    const start = s.hexes.find((h) => h.terrain === 'start')!;
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const seamSym = blockadeSymbolForTest(blockade);
    const crossing =
      blockade.edges
        .map((e) => {
          const toIsB = cubeDistTest(e.b, start) >= cubeDistTest(e.a, start);
          return { from: toIsB ? e.a : e.b, to: toIsB ? e.b : e.a };
        })
        .find(({ to }) => {
          const dest = hexAt(to);
          if (['mountain', 'rubble', 'basecamp'].includes(dest.terrain)) return false;
          const destSym = terrainSymbolForTest(dest.terrain);
          return (destSym === null || destSym === seamSym) && key(to) !== key(blockade.b);
        }) ?? seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);

    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'StepTo', to: crossing.to },
    );

    expect(result.ok).toBe(true);
    expect(state.blockades[0].claimedBy).toBe('p0');
    expect(state.players[0].claimedBlockades).toEqual([blockade.id]);
  });

  it('requires the blockade resource before it is claimed', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    const wrong = otherSymbol(symbol);
    placeAt(s, 'p0', blockade.a);
    giveHand(s, 'p0', [BASIC_CARD_BY_SYMBOL[wrong]]);

    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${BASIC_CARD_BY_SYMBOL[wrong]}#t0`, symbol: wrong },
      { type: 'StepTo', to: blockade.b },
    );

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/需要/);
  });

  it('requires discarding cards to claim a rubble blockade', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );
    const blockade = s.blockades.find((b) => b.terrain === 'rubble')!;
    expect(blockade.symbol).toBeUndefined();
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const edge =
      blockade.edges.find((e) => hexAt(e.a).terrain !== 'mountain' && hexAt(e.b).terrain !== 'mountain') ??
      blockade.edges[0];

    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: edge.b },
    );
    expect(r.result.ok).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/弃 1 张手牌/);

    r = run(s, 'p0', {
      type: 'ClearSpace',
      to: edge.b,
      cardIds: ['p0:pioneer#t0'],
    });
    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p0')).toEqual(edge.b);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(r.state.players[0].claimedBlockades).toEqual([blockade.id]);
    expect(r.state.players[0].discard.some((c) => c.id === 'p0:pioneer#t0')).toBe(true);
    expect(r.result.events).toContainEqual({ type: 'blockadeClaimed', playerId: 'p0', blockadeId: blockade.id });
  });

  it('does not require the blockade resource after the first player claims it', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const start = s.hexes.find((h) => h.terrain === 'start')!;
    // Pick a blockade that has BOTH a compatible edge (so p0 can claim it) and an
    // incompatible-symbol edge (so p1 must rely on the seam already being open).
    const picked = s.blockades
      .map((blockade) => ({ blockade, claim: seamCrossing(s, blockade, true), open: seamCrossing(s, blockade, false) }))
      .find((x) => x.claim && x.open)!;
    const blockade = picked.blockade;
    const claim = picked.claim!;
    const open = picked.open!;
    const blockadeSymbol = blockadeSymbolForTest(blockade);
    const targetSymbol = terrainSymbolForTest(open.dest.terrain)!;

    // p0 claims the marker by crossing a compatible edge.
    placeAt(s, 'p0', claim.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[blockadeSymbol]]);
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[blockadeSymbol]}#t0`, symbol: blockadeSymbol },
      { type: 'StepTo', to: claim.to },
    );

    expect(r.result.ok).toBe(true);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(r.state.players[0].claimedBlockades).toEqual([blockade.id]);

    // Park p0 out of the way, then p1 crosses the now-open seam onto a
    // different-symbol terrain using only that terrain's own requirement.
    const parking = r.state.hexes.find(
      (h) => !h.occupant && h.terrain !== 'mountain' && key(h) !== key(open.from) && key(h) !== key(open.to),
    )!;
    placeAt(r.state, 'p0', parking);
    placeAt(r.state, 'p1', open.from);
    r.state.turn = {
      playerId: 'p1',
      inPlay: [],
      removedThisTurn: [],
      hasBought: false,
    };
    giveHand(r.state, 'p1', [STRONG_CARD_BY_SYMBOL[targetSymbol]]);

    r = run(
      r.state,
      'p1',
      { type: 'PlayMovementCard', cardId: `p1:${STRONG_CARD_BY_SYMBOL[targetSymbol]}#t0`, symbol: targetSymbol },
      { type: 'StepTo', to: open.to },
    );

    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p1')).toEqual(open.to);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(r.state.players[1].claimedBlockades).toEqual([]);
    expect(r.result.events).not.toContainEqual({
      type: 'blockadeClaimed',
      playerId: 'p1',
      blockadeId: blockade.id,
    });
  });
});

describe('seam crossing cost (blockade + destination terrain)', () => {
  const startGame = () =>
    createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      11,
    );

  it('charges blockade cost PLUS destination terrain cost on the first crossing', () => {
    const s = startGame();
    const blockade = s.blockades[0]; // green / machete, cost 1
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true);
    expect(crossing).toBeTruthy();
    placeAt(s, 'p0', crossing!.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]); // pioneer, machete power 5
    const { state, result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'StepTo', to: crossing!.to },
    );
    expect(result.ok).toBe(true);
    expect(pos(state, 'p0')).toEqual(crossing!.to);
    expect(state.blockades[0].claimedBy).toBe('p0');
    // 5 (pioneer) − (blockade.cost + destination terrain cost)
    expect(state.turn!.activeMover!.remaining).toBe(5 - (blockade.cost + crossing!.dest.cost));
  });

  it('rejects crossing onto a terrain whose symbol differs from the seam symbol', () => {
    const s = startGame();
    const blockade = s.blockades[0]; // machete
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, false);
    if (!crossing) return; // no incompatible edge on this seam → nothing to assert
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'StepTo', to: crossing.to },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects crossing when power covers the blockade but not the destination terrain', () => {
    const s = startGame();
    const blockade = s.blockades[0]; // machete, cost 1
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true);
    placeAt(s, 'p0', crossing!.from);
    giveHand(s, 'p0', [BASIC_CARD_BY_SYMBOL[symbol]]); // explorer, machete power 1
    const { result } = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${BASIC_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'StepTo', to: crossing!.to },
    );
    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/移动力量不足/);
  });
});

describe('special spaces', () => {
  it('basecamp removes the spent cards from the game', () => {
    const s = game();
    placeAt(s, 'p0', { q: 11, r: 0 }); // green2, adjacent to basecamp (12,0) cost2
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller']);
    const { state, result } = run(s, 'p0', {
      type: 'ClearSpace',
      to: { q: 12, r: 0 },
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].removed).toHaveLength(2);
    expect(pos(state, 'p0')).toEqual({ q: 12, r: 0 });
  });

  it('rubble sends the spent cards to discard', () => {
    const s = game();
    placeAt(s, 'p0', { q: 6, r: 0 }); // yellow1, adjacent to rubble (7,0) cost2
    giveHand(s, 'p0', ['explorer', 'sailor']);
    const { state, result } = run(s, 'p0', {
      type: 'ClearSpace',
      to: { q: 7, r: 0 },
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].discard).toHaveLength(2);
    expect(state.players[0].removed).toHaveLength(0);
  });
});

describe('buying', () => {
  it('buys an on-board card with enough coins', () => {
    const s = game();
    giveHand(s, 'p0', ['traveller', 'traveller']); // 2 coins
    const { state, result } = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer', // cost 2
      paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
    });
    expect(result.ok).toBe(true);
    expect(state.players[0].discard.some((c) => c.defId === 'photographer')).toBe(true);
    expect(state.turn!.hasBought).toBe(true);
    expect(state.market.find((m) => m.defId === 'photographer')!.count).toBe(2);
  });

  it('rejects a purchase without enough coins', () => {
    const s = game();
    giveHand(s, 'p0', ['traveller']); // 1 coin
    const { result } = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer',
      paymentCardIds: ['p0:traveller#t0'],
    });
    expect(result.ok).toBe(false);
  });

  it('allows only one purchase per turn', () => {
    const s = game();
    giveHand(s, 'p0', ['millionaire', 'millionaire']); // coin 4 each
    const r1 = applyAction(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer',
      paymentCardIds: ['p0:millionaire#t0'],
    });
    expect(r1.result.ok).toBe(true);
    const r2 = applyAction(r1.state, 'p0', {
      type: 'BuyCard',
      defId: 'scout',
      paymentCardIds: ['p0:millionaire#t1'],
    });
    expect(r2.result.ok).toBe(false);
  });
});

describe('turn flow', () => {
  it('end turn draws back to hand size and advances player', () => {
    const s = game(2);
    const r = applyAction(s, 'p0', { type: 'EndTurn' });
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.playerId).toBe('p1');
    expect(r.state.players[1].hand.length).toBe(4);
  });
});

describe('winning', () => {
  it('classic map requires entering an entrance before stepping onto El Dorado', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      7,
    );
    const entrance = s.hexes.find(
      (h) => h.terrain === 'finish' && s.hexes.some((c) => c.terrain === 'eldorado' && isAdjacent(h, c)),
    )!;
    const city = s.hexes.find((h) => h.terrain === 'eldorado' && isAdjacent(h, entrance))!;
    const stand = neighbors(entrance)
      .map((n) => s.hexes.find((h) => h.q === n.q && h.r === n.r))
      .find((h): h is Hex => !!h && h.terrain !== 'finish' && h.terrain !== 'eldorado' && h.terrain !== 'mountain')!;

    placeAt(s, 'p0', { q: stand.q, r: stand.r });
    giveHand(s, 'p0', ['journalist']);
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:journalist#t0', symbol: 'coin' },
      { type: 'StepTo', to: { q: entrance.q, r: entrance.r } },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.players[0].finished).toBe(false);

    r = run(r.state, 'p0', { type: 'StepTo', to: { q: city.q, r: city.r } });
    expect(r.result.ok).toBe(true);
    expect(r.state.players[0].finished).toBe(true);
    expect(r.state.finalTurnsRemaining).toBe(1);
  });

  it('reaching El Dorado finishes the game after the final round', () => {
    let s = game(2);
    placeAt(s, 'p0', { q: 16, r: 0 }); // green2, adjacent to finish (17,0)
    giveHand(s, 'p0', ['pioneer']); // machete 5
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 17, r: 0 } },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.players[0].finished).toBe(true);
    expect(r.state.finalTurnsRemaining).toBe(1); // p1 gets one more turn

    // p0 ends turn → p1 takes the final turn
    r = run(r.state, 'p0', { type: 'EndTurn' });
    expect(r.state.turn!.playerId).toBe('p1');

    // p1 ends without finishing → game over, p0 wins
    r = run(r.state, 'p1', { type: 'EndTurn' });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBe('p0');
  });

  it('only players later in the current round get final turns', () => {
    let s = game(4);
    setTurn(s, 'p1');
    placeAt(s, 'p1', { q: 16, r: 0 }); // green2, adjacent to finish (17,0)
    giveHand(s, 'p1', ['pioneer']);

    let r = run(
      s,
      'p1',
      { type: 'PlayMovementCard', cardId: 'p1:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: { q: 17, r: 0 } },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.players[1].finished).toBe(true);
    expect(r.state.finalTurnsRemaining).toBe(2); // p2 and p3 only; p0 is earlier in this round

    r = run(r.state, 'p1', { type: 'EndTurn' });
    expect(r.state.turn!.playerId).toBe('p2');
    r = run(r.state, 'p2', { type: 'EndTurn' });
    expect(r.state.turn!.playerId).toBe('p3');
    r = run(r.state, 'p3', { type: 'EndTurn' });
    expect(r.state.phase).toBe('finished');
    expect(r.state.turn).toBeNull();
    expect(r.state.winnerId).toBe('p1');
  });

  it('uses claimed blockades as the first winner tie-breaker', () => {
    const s = game(3);
    s.players[1].finished = true;
    s.players[1].finishedAt = 2;
    s.players[1].claimedBlockades = ['b1'];
    s.players[1].blockades = 1;
    s.players[2].finished = true;
    s.players[2].finishedAt = 3;
    s.players[2].claimedBlockades = ['b2', 'b3'];
    s.players[2].blockades = 2;
    s.finalRoundTriggeredBy = 'p1';
    s.finalTurnsRemaining = 0;

    const r = run(s, 'p0', { type: 'EndTurn' });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBe('p2');
  });

  it('uses earlier El Dorado arrival if finished players have equal blockades', () => {
    const s = game(3);
    s.players[1].finished = true;
    s.players[1].finishedAt = 2;
    s.players[1].claimedBlockades = ['b1'];
    s.players[1].blockades = 1;
    s.players[2].finished = true;
    s.players[2].finishedAt = 3;
    s.players[2].claimedBlockades = ['b2'];
    s.players[2].blockades = 1;
    s.finalRoundTriggeredBy = 'p1';
    s.finalTurnsRemaining = 0;

    const r = run(s, 'p0', { type: 'EndTurn' });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBe('p1');
  });
});
