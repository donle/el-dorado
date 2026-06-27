import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/engine/index.js';
import { isAdjacent, key, neighbors } from '../src/hex.js';
import { getDef } from '../src/cards.js';
import type { GameState, Axial, Card, Hex, MoveSymbol, Terrain, Blockade } from '../src/types.js';
import type { Action } from '../src/actions.js';

function game(players = 2): GameState {
  const seeds = [
    { id: 'p0', name: 'A', color: 'red' as const },
    { id: 'p1', name: 'B', color: 'blue' as const },
    { id: 'p2', name: 'C', color: 'green' as const },
    { id: 'p3', name: 'D', color: 'yellow' as const },
  ].slice(0, players);
  const s = createGame(seeds, 'corridor', 42);
  s.turnOrder = seeds.map((p) => p.id);
  s.currentPlayerIdx = 0;
  s.turn = {
    playerId: s.turnOrder[0],
    inPlay: [],
    removedThisTurn: [],
    hasBought: false,
    hasDiscarded: false,
  };
  return s;
}

function giveHand(s: GameState, pid: string, defs: string[]): void {
  const p = s.players.find((x) => x.id === pid)!;
  p.hand = defs.map((d, i): Card => ({ id: `${pid}:${d}#t${i}`, defId: d }));
}

function giveDeck(s: GameState, pid: string, defs: string[]): void {
  const p = s.players.find((x) => x.id === pid)!;
  p.deck = defs.map((d, i): Card => ({ id: `${pid}:${d}#d${i}`, defId: d }));
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
    hasDiscarded: false,
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
    const playerStarts = s.players.map((p) => {
      const h = s.hexes.find((x) => x.q === p.position.q && x.r === p.position.r)!;
      expect(h.terrain).toBe('start');
      expect(h.occupant).toBe(p.id);
      return key(h);
    });
    const playerStartSlots = s.players.map((p) => {
      const h = s.hexes.find((x) => x.q === p.position.q && x.r === p.position.r)!;
      return h.slot;
    });
    const again = game(2);
    expect(again.players.map((p) => key(p.position))).toEqual(playerStarts);
    expect(playerStartSlots.slice().sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2]);
    const startOccupied = s.hexes.filter((h) => h.terrain === 'start' && h.occupant);
    expect(startOccupied).toHaveLength(2);

    const twoPlayerSeeds = [
      { id: 'p0', name: 'A', color: 'red' as const },
      { id: 'p1', name: 'B', color: 'blue' as const },
    ];
    const assignments = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const seeded = createGame(twoPlayerSeeds, 'corridor', seed);
      const slots = seeded.players.map((p) => seeded.hexes.find((x) => x.q === p.position.q && x.r === p.position.r)!.slot);
      expect(slots.slice().sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2]);
      assignments.add(slots.join(','));
    }
    expect(assignments).toContain('1,2');
    expect(assignments).toContain('2,1');

    const s4 = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
        { id: 'p2', name: 'C', color: 'green' as const },
        { id: 'p3', name: 'D', color: 'yellow' as const },
      ],
      'corridor',
      42,
    );
    const occupiedBySlot = s4.hexes
      .filter((h) => h.terrain === 'start' && h.occupant)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map((h) => h.occupant!);
    expect(s4.turnOrder).toEqual(occupiedBySlot);
    expect(s4.turn!.playerId).toBe(occupiedBySlot[0]);
    expect(s4.turnOrder).not.toEqual(s4.players.map((p) => p.id));
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

  it('native can enter a mountain while ignoring terrain requirements', () => {
    const s = game();
    placeAt(s, 'p0', { q: 10, r: 0 }); // blue3 next to mountain (10,1)
    giveHand(s, 'p0', ['native']);

    const { state, result } = run(
      s,
      'p0',
      { type: 'UseAbility', cardId: 'p0:native#t0', nativeTo: { q: 10, r: 1 } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(pos(state, 'p0')).toEqual({ q: 10, r: 1 });
    expect(result.events).toContainEqual({ type: 'ability', playerId: 'p0', cardId: 'p0:native#t0' });
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
      return !h || (h.terrain !== 'eldorado' && h.terrain !== 'finish' && !h.finishEntrance);
    })!;

    const pid = s.turn!.playerId;
    placeAt(s, pid, stand);
    giveHand(s, pid, ['pioneer']);
    const { result } = run(
      s,
      pid,
      { type: 'PlayMovementCard', cardId: `${pid}:pioneer#t0`, symbol: 'machete' },
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

    const removed = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    // The marker is claimed by RemoveBlockade, before the step.
    expect(removed.result.ok).toBe(true);
    expect(removed.state.blockades[0].claimedBy).toBe('p0');
    expect(removed.result.events).toContainEqual({ type: 'blockadeClaimed', playerId: 'p0', blockadeId: blockade.id });

    const { state, result } = run(removed.state, 'p0', { type: 'StepTo', to: crossing.to });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(state.blockades[0].claimedBy).toBe('p0');
    expect(state.players[0].claimedBlockades).toEqual([blockade.id]);
    expect(state.players[0].blockades).toBe(1);
    expect(pos(state, 'p0')).toEqual(crossing.to);
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
      { type: 'RemoveBlockade', blockadeId: blockade.id },
      { type: 'StepTo', to: crossing.to },
    );

    expect(result.ok).toBe(true);
    expect(state.blockades[0].claimedBy).toBe('p0');
    expect(state.players[0].claimedBlockades).toEqual([blockade.id]);
    expect(pos(state, 'p0')).toEqual(crossing.to);
  });

  it('can atomically play a movement card to remove a blockade', () => {
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
    const cardDef = STRONG_CARD_BY_SYMBOL[symbol];
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [cardDef]);

    const cardId = `p0:${cardDef}#t0`;
    const { state, result } = run(s, 'p0', {
      type: 'RemoveBlockade',
      blockadeId: blockade.id,
      cardId,
      symbol,
    });

    expect(result.ok).toBe(true);
    expect(state.players[0].hand.some((c) => c.id === cardId)).toBe(false);
    expect(state.turn!.inPlay.some((c) => c.id === cardId)).toBe(true);
    expect(state.turn!.activeMover).toEqual({
      cardId,
      symbol,
      remaining: getDef(cardDef).power - blockade.cost,
    });
    expect(state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
  });

  it('does not consume a movement card when atomic blockade removal is invalid', () => {
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
    const cardDef = STRONG_CARD_BY_SYMBOL[symbol];
    const farHex = s.hexes.find(
      (h) =>
        h.terrain !== 'mountain' &&
        !blockade.edges.some((e) => key(e.a) === key(h) || key(e.b) === key(h)),
    )!;
    placeAt(s, 'p0', farHex);
    giveHand(s, 'p0', [cardDef]);

    const cardId = `p0:${cardDef}#t0`;
    const { state, result } = run(s, 'p0', {
      type: 'RemoveBlockade',
      blockadeId: blockade.id,
      cardId,
      symbol,
    });

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/旁边/);
    expect(state.players[0].hand).toEqual([{ id: cardId, defId: cardDef }]);
    expect(state.turn!.inPlay).toEqual([]);
    expect(state.turn!.activeMover).toBeUndefined();
    expect(state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBeUndefined();
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

    // edge.b is a green (machete) terrain cost 3 — keep pioneer (machete, power 5)
    // as the mover for the step, and discard explorer to claim the rubble seam.
    const destHex = hexAt(edge.b);
    expect(destHex.terrain).toBe('green');
    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);

    // A step across the still-unclaimed rubble seam is now rejected: the seam
    // must be removed first (the rubble seam carries no symbol, so a movement
    // card cannot cross it at all).
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: edge.b },
    );
    expect(r.result.ok).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/先移除连接地形/);

    // Claim the rubble seam in place by discarding cost cards; the pawn stays.
    // (Start fresh from `s` so the mover/hand are untouched for the real run.)
    r = run(s, 'p0', {
      type: 'RemoveBlockade',
      blockadeId: blockade.id,
      cardIds: ['p0:explorer#t1'],
    });
    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p0')).toEqual(edge.a); // 留在原地
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(r.state.players[0].claimedBlockades).toEqual([blockade.id]);
    expect(r.state.players[0].discard.some((c) => c.id === 'p0:explorer#t1')).toBe(true);
    expect(r.result.events).toContainEqual({ type: 'blockadeClaimed', playerId: 'p0', blockadeId: blockade.id });

    // Now a separate step onto the far hex (green, cost 3) succeeds.
    r = run(
      r.state,
      'p0',
      { type: 'PlayMovementCard', cardId: 'p0:pioneer#t0', symbol: 'machete' },
      { type: 'StepTo', to: edge.b },
    );
    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p0')).toEqual(edge.b);
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
      { type: 'RemoveBlockade', blockadeId: blockade.id },
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

  it('charges blockade cost on removal, then only the destination terrain on the step', () => {
    const s = startGame();
    const blockade = s.blockades[0]; // green / machete, cost 1
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true);
    expect(crossing).toBeTruthy();
    placeAt(s, 'p0', crossing!.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]); // pioneer, machete power 5
    const power = getDef(STRONG_CARD_BY_SYMBOL[symbol]).power;

    // Step 1: remove the seam — only blockade.cost is deducted; pawn stays put.
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.blockades[0].claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(crossing!.from);
    expect(r.state.turn!.activeMover!.remaining).toBe(power - blockade.cost);

    // Step 2: the step onto the far hex charges only the destination terrain.
    r = run(r.state, 'p0', { type: 'StepTo', to: crossing!.to });
    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p0')).toEqual(crossing!.to);
    expect(r.state.turn!.activeMover!.remaining).toBe(power - blockade.cost - crossing!.dest.cost);
  });

  it('can reach a different-symbol far hex by removing with the seam symbol then stepping with the far symbol', () => {
    // The old atomic crossing rejected a far terrain whose symbol differed from
    // the seam symbol (one mover had to satisfy both). With removal and the step
    // decoupled they may use different cards, so this is now possible.
    const s = startGame();
    const blockade = s.blockades[0]; // green / machete
    const symbol = blockadeSymbolForTest(blockade); // machete
    // seed 11/classic: blockade[0] has incompatible (paddle) edges. Assert it
    // loudly so a future map change fails here instead of going silently vacuous.
    const crossing = seamCrossing(s, blockade, false);
    expect(crossing, 'expected an incompatible-symbol edge on seed 11/classic').toBeTruthy();
    if (!crossing) return; // narrows for TS; the expect above already failed if null
    const destSymbol = terrainSymbolForTest(crossing.dest.terrain)!; // e.g. paddle
    expect(destSymbol).not.toBe(symbol);
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);

    // Same seam-symbol mover cannot continue onto the different-symbol far hex.
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
      { type: 'StepTo', to: crossing.to },
    );
    expect(r.result.ok).toBe(false);
    expect((r.result as { error: string }).error).toMatch(/才能进入/);
    // The seam is now claimed (removal succeeded) but the pawn never crossed.
    expect(r.state.blockades[0].claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(crossing.from);

    // Playing a far-terrain-symbol card and stepping now succeeds.
    giveHand(r.state, 'p0', [STRONG_CARD_BY_SYMBOL[destSymbol]]);
    r = run(
      r.state,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[destSymbol]}#t0`, symbol: destSymbol },
      { type: 'StepTo', to: crossing.to },
    );
    expect(r.result.ok).toBe(true);
    expect(pos(r.state, 'p0')).toEqual(crossing.to);
  });

  it('rejects the step when the mover has spent its power on the seam removal', () => {
    // Under the old atomic model a single weak mover paid blockade + terrain at
    // once. Now removal and the step are independent power checks: a weak mover
    // can claim the seam but is then too spent to enter the far terrain.
    const s = startGame();
    const blockade = s.blockades[0]; // machete, cost 1
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true);
    placeAt(s, 'p0', crossing!.from);
    giveHand(s, 'p0', [BASIC_CARD_BY_SYMBOL[symbol]]); // explorer, machete power 1
    // Removal succeeds and spends the mover down to 0 power.
    let r = run(
      s,
      'p0',
      { type: 'PlayMovementCard', cardId: `p0:${BASIC_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.activeMover!.remaining).toBe(0);
    // The far hex (green, cost 2) can no longer be entered with this mover.
    r = run(r.state, 'p0', { type: 'StepTo', to: crossing!.to });
    expect(r.result.ok).toBe(false);
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

  it('leaves an empty market slot instead of auto-promoting a reserve pile', () => {
    const s = game();
    const photographer = s.market.find((m) => m.defId === 'photographer')!;
    const pioneer = s.market.find((m) => m.defId === 'pioneer')!;
    photographer.count = 1;
    expect(photographer.onBoard).toBe(true);
    expect(pioneer.onBoard).toBe(false);
    giveHand(s, 'p0', ['traveller', 'traveller']);

    const r = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'photographer',
      paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
    });

    expect(r.result.ok).toBe(true);
    expect(r.state.market.find((m) => m.defId === 'photographer')!).toMatchObject({ count: 0, onBoard: false });
    expect(r.state.market.find((m) => m.defId === 'pioneer')!.onBoard).toBe(false);
    expect(r.state.market.filter((m) => m.onBoard && m.count > 0)).toHaveLength(5);

    const sameTurnPromote = run(r.state, 'p0', { type: 'PromoteMarket', defId: 'pioneer' });
    expect(sameTurnPromote.result.ok).toBe(false);
  });

  it('allows the next player to buy an on-board pile while the market has a vacancy', () => {
    const s = game();
    s.market.find((m) => m.defId === 'photographer')!.count = 1;
    giveHand(s, 'p0', ['traveller', 'traveller']);

    let r = run(
      s,
      'p0',
      {
        type: 'BuyCard',
        defId: 'photographer',
        paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
      },
      { type: 'EndTurn' },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.playerId).toBe('p1');
    giveHand(r.state, 'p1', ['millionaire']);

    r = run(r.state, 'p1', {
      type: 'BuyCard',
      defId: 'scout',
      paymentCardIds: ['p1:millionaire#t0'],
    });
    expect(r.result.ok).toBe(true);
    expect(r.result.events).not.toContainEqual({ type: 'marketPromoted', playerId: 'p1', defId: 'scout' });
    expect(r.state.players[1].discard.some((c) => c.defId === 'scout')).toBe(true);
    expect(r.state.market.find((m) => m.defId === 'pioneer')!.onBoard).toBe(false);
  });

  it('rejects buying a reserve pile directly when the market has a vacancy', () => {
    const s = game();
    s.market.find((m) => m.defId === 'photographer')!.count = 1;
    giveHand(s, 'p0', ['traveller', 'traveller']);

    let r = run(
      s,
      'p0',
      {
        type: 'BuyCard',
        defId: 'photographer',
        paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
      },
      { type: 'EndTurn' },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.playerId).toBe('p1');
    giveHand(r.state, 'p1', ['millionaire', 'millionaire']);

    r = run(r.state, 'p1', {
      type: 'BuyCard',
      defId: 'pioneer',
      paymentCardIds: ['p1:millionaire#t0', 'p1:millionaire#t1'],
    });
    expect(r.result.ok).toBe(false);
    expect(r.state.market.find((m) => m.defId === 'pioneer')!.onBoard).toBe(false);
    expect(r.state.players[1].discard.some((c) => c.defId === 'pioneer')).toBe(false);
  });

  it('allows promoting a reserve pile into a vacancy before buying it', () => {
    const s = game();
    s.market.find((m) => m.defId === 'photographer')!.count = 1;
    giveHand(s, 'p0', ['traveller', 'traveller']);

    let r = run(
      s,
      'p0',
      {
        type: 'BuyCard',
        defId: 'photographer',
        paymentCardIds: ['p0:traveller#t0', 'p0:traveller#t1'],
      },
      { type: 'EndTurn' },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.turn!.playerId).toBe('p1');
    giveHand(r.state, 'p1', ['millionaire', 'millionaire']);

    r = run(r.state, 'p1', { type: 'PromoteMarket', defId: 'pioneer' });
    expect(r.result.ok).toBe(true);
    expect(r.result.events).toContainEqual({ type: 'marketPromoted', playerId: 'p1', defId: 'pioneer' });

    r = run(r.state, 'p1', {
      type: 'BuyCard',
      defId: 'pioneer',
      paymentCardIds: ['p1:millionaire#t0', 'p1:millionaire#t1'],
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.market.find((m) => m.defId === 'pioneer')!.onBoard).toBe(true);
    expect(r.state.market.find((m) => m.defId === 'pioneer')!.count).toBe(2);
    expect(r.state.turn!.hasBought).toBe(true);
    expect(r.state.players[1].discard.some((c) => c.defId === 'pioneer')).toBe(true);
  });

  it('rejects buying a reserve pile while the market is full', () => {
    const s = game();
    giveHand(s, 'p0', ['millionaire']);
    const r = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'pioneer',
      paymentCardIds: ['p0:millionaire#t0'],
    });
    expect(r.result.ok).toBe(false);
  });

  it('puts a bought cartographer into hand so it can be used immediately', () => {
    const s = game();
    s.market.find((m) => m.defId === 'cartographer')!.onBoard = true;
    giveHand(s, 'p0', ['journalist']);
    giveDeck(s, 'p0', ['scout', 'captain']);

    let r = run(s, 'p0', {
      type: 'BuyCard',
      defId: 'cartographer',
      paymentCardIds: ['p0:journalist#t0'],
    });
    expect(r.result.ok).toBe(true);
    const cartographer = r.state.players[0].hand.find((c) => c.defId === 'cartographer');
    expect(cartographer).toBeTruthy();
    expect(r.state.players[0].discard.some((c) => c.defId === 'cartographer')).toBe(false);

    r = run(r.state, 'p0', { type: 'UseAbility', cardId: cartographer!.id });
    expect(r.result.ok).toBe(true);
    expect(r.result.events).toContainEqual({ type: 'drew', playerId: 'p0', count: 2 });
    expect(r.state.players[0].hand.map((c) => c.defId)).toEqual(['scout', 'captain']);
    expect(r.state.turn!.inPlay.some((c) => c.defId === 'cartographer')).toBe(true);
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
      (h) =>
        h.finishEntrance === true &&
        h.terrain === 'blue' &&
        s.hexes.some((c) => c.terrain === 'eldorado' && isAdjacent(h, c)),
    )!;
    const city = s.hexes.find((h) => h.terrain === 'eldorado' && isAdjacent(h, entrance))!;
    const stand = neighbors(entrance)
      .map((n) => s.hexes.find((h) => h.q === n.q && h.r === n.r))
      .find(
        (h): h is Hex =>
          !!h && h.terrain !== 'finish' && !h.finishEntrance && h.terrain !== 'eldorado' && h.terrain !== 'mountain',
      )!;

    const pid = s.turn!.playerId;
    const playerIndex = s.players.findIndex((p) => p.id === pid);
    placeAt(s, pid, { q: stand.q, r: stand.r });
    giveHand(s, pid, ['sailor']);
    let r = run(
      s,
      pid,
      { type: 'PlayMovementCard', cardId: `${pid}:sailor#t0`, symbol: 'paddle' },
      { type: 'StepTo', to: { q: entrance.q, r: entrance.r } },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.players[playerIndex].finished).toBe(false);

    r.state.turn!.activeMover = undefined;
    r = run(r.state, pid, { type: 'StepTo', to: { q: city.q, r: city.r } });
    expect(r.result.ok).toBe(true);
    expect(r.state.players[playerIndex].finished).toBe(true);
    expect(r.state.finalTurnsRemaining).toBe(1);
  });

  it('steps from an entrance onto El Dorado without playing a card', () => {
    const s = createGame(
      [
        { id: 'p0', name: 'A', color: 'red' as const },
        { id: 'p1', name: 'B', color: 'blue' as const },
      ],
      'classic',
      7,
    );
    const entrance = s.hexes.find(
      (h) => h.finishEntrance === true && s.hexes.some((c) => c.terrain === 'eldorado' && isAdjacent(h, c)),
    )!;
    const city = s.hexes.find((h) => h.terrain === 'eldorado' && isAdjacent(h, entrance))!;

    const pid = s.turn!.playerId;
    const playerIndex = s.players.findIndex((p) => p.id === pid);
    placeAt(s, pid, { q: entrance.q, r: entrance.r });
    giveHand(s, pid, []);
    s.turn!.activeMover = undefined;

    const r = run(s, pid, { type: 'StepTo', to: { q: city.q, r: city.r } });
    expect(r.result.ok).toBe(true);
    expect(r.state.players[playerIndex].finished).toBe(true);
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

describe('DiscardCards skill', () => {
  it('moves chosen cards to the discard pile without drawing', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer']);
    const before = s.players.find((p) => p.id === 'p0')!.deck.length;
    const r = run(s, 'p0', {
      type: 'DiscardCards',
      cardIds: ['p0:explorer#t0', 'p0:sailor#t1'],
    });
    const p = r.state.players.find((x) => x.id === 'p0')!;
    expect(r.result.ok).toBe(true);
    expect(p.hand.map((c) => c.id)).toEqual(['p0:traveller#t2', 'p0:photographer#t3']);
    expect(p.discard.map((c) => c.id)).toEqual(['p0:explorer#t0', 'p0:sailor#t1']);
    expect(p.deck.length).toBe(before); // 不补牌
    expect(r.state.turn!.hasDiscarded).toBe(true);
  });

  it('allows multiple discards in the same turn', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor']);
    let r = run(s, 'p0', { type: 'DiscardCards', cardIds: ['p0:explorer#t0'] });
    r = run(r.state, 'p0', { type: 'DiscardCards', cardIds: ['p0:sailor#t1'] });
    const p = r.state.players.find((x) => x.id === 'p0')!;
    expect(r.result.ok).toBe(true);
    expect(p.hand).toEqual([]);
    expect(p.discard.map((c) => c.id)).toEqual(['p0:explorer#t0', 'p0:sailor#t1']);
    expect(r.state.turn!.hasDiscarded).toBe(true);
  });

  it('rejects discarding a card not in hand', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer']);
    const r = run(s, 'p0', { type: 'DiscardCards', cardIds: ['p0:ghost#t9'] });
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error).toContain('不在手牌中');
  });

  it('rejects empty discard and still allows a later discard', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor']);
    const r1 = run(s, 'p0', { type: 'DiscardCards', cardIds: [] });
    expect(r1.result.ok).toBe(false);
    expect(r1.state.turn!.hasDiscarded).toBe(false);
    const r2 = run(r1.state, 'p0', { type: 'DiscardCards', cardIds: ['p0:explorer#t0'] });
    expect(r2.result.ok).toBe(true);
    expect(r2.state.turn!.hasDiscarded).toBe(true);
  });

  it('EndTurn with hand ≤ 4 advances without setting pendingTrim', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer']);
    const r = run(s, 'p0', { type: 'EndTurn' });
    // EndTurn still draws up to HAND_SIZE, but need = HAND_SIZE - 4 = 0 here,
    // so nothing is drawn and the hand stays at 4 cards; the leftover hand is NOT discarded.
    const p = r.state.players.find((x) => x.id === 'p0')!;
    expect(r.result.ok).toBe(true);
    expect(p.discard.length).toBe(0);
    expect(p.hand).toHaveLength(4);
    expect(r.state.turn?.pendingTrim).toBeUndefined();
  });
});

describe('draw-then-remove abilities', () => {
  it('draws before choosing removal, so the drawn card can be removed', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['scientist', 'explorer']);
    giveDeck(s, 'p0', ['sailor']);

    const used = run(s, 'p0', { type: 'UseAbility', cardId: 'p0:scientist#t0' });
    expect(used.result.ok).toBe(true);
    expect(used.result.events).toContainEqual({ type: 'drew', playerId: 'p0', count: 1 });
    expect(used.result.events).toContainEqual({ type: 'ability', playerId: 'p0', cardId: 'p0:scientist#t0' });
    expect(used.state.turn!.pendingRemoval).toEqual({ sourceCardId: 'p0:scientist#t0', max: 1 });
    expect(used.state.turn!.inPlay.map((c) => c.id)).toEqual(['p0:scientist#t0']);
    expect(used.state.players[0].hand.map((c) => c.id)).toEqual(['p0:explorer#t1', 'p0:sailor#d0']);

    const removed = run(used.state, 'p0', { type: 'RemoveCards', cardIds: ['p0:sailor#d0'] });
    expect(removed.result.ok).toBe(true);
    expect(removed.result.events).toContainEqual({ type: 'removedCards', playerId: 'p0', count: 1 });
    expect(removed.state.turn!.pendingRemoval).toBeUndefined();
    expect(removed.state.players[0].hand.map((c) => c.id)).toEqual(['p0:explorer#t1']);
    expect(removed.state.turn!.removedThisTurn.map((c) => c.id)).toEqual(['p0:sailor#d0']);
  });

  it('allows skipping the optional removal after drawing', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['travel_log']);
    giveDeck(s, 'p0', ['sailor', 'explorer']);

    const used = run(s, 'p0', { type: 'UseAbility', cardId: 'p0:travel_log#t0' });
    expect(used.result.ok).toBe(true);
    expect(used.state.turn!.pendingRemoval).toEqual({ sourceCardId: 'p0:travel_log#t0', max: 2 });
    expect(used.state.turn!.removedThisTurn.map((c) => c.id)).toEqual(['p0:travel_log#t0']);
    expect(used.state.players[0].hand.map((c) => c.id)).toEqual(['p0:sailor#d0', 'p0:explorer#d1']);

    const skipped = run(used.state, 'p0', { type: 'RemoveCards', cardIds: [] });
    expect(skipped.result.ok).toBe(true);
    expect(skipped.result.events).toContainEqual({ type: 'removedCards', playerId: 'p0', count: 0 });
    expect(skipped.state.turn!.pendingRemoval).toBeUndefined();
    expect(skipped.state.players[0].hand.map((c) => c.id)).toEqual(['p0:sailor#d0', 'p0:explorer#d1']);
  });

  it('blocks other actions until the removal choice is resolved', () => {
    const s = game(2);
    setTurn(s, 'p0');
    giveHand(s, 'p0', ['scientist', 'explorer']);
    giveDeck(s, 'p0', ['sailor']);

    const used = run(s, 'p0', { type: 'UseAbility', cardId: 'p0:scientist#t0' });
    const moved = run(used.state, 'p0', { type: 'PlayMovementCard', cardId: 'p0:explorer#t1', symbol: 'machete' });
    expect(moved.result.ok).toBe(false);
    if (!moved.result.ok) expect(moved.result.error).toContain('请先处理要移除的手牌');
    const ended = run(used.state, 'p0', { type: 'EndTurn' });
    expect(ended.result.ok).toBe(false);
    if (!ended.result.ok) expect(ended.result.error).toContain('请先处理要移除的手牌');
    expect(moved.state.turn!.pendingRemoval).toEqual({ sourceCardId: 'p0:scientist#t0', max: 1 });
    expect(moved.state.players[0].hand.map((c) => c.id)).toEqual(['p0:explorer#t1', 'p0:sailor#d0']);

    const resolved = run(moved.state, 'p0', { type: 'RemoveCards', cardIds: [] });
    expect(resolved.result.ok).toBe(true);
    expect(resolved.state.turn!.pendingRemoval).toBeUndefined();
  });
});

describe('RemoveBlockade (decoupled)', () => {
  it('symbol blockade: deducts only blockade.cost, keeps remaining mover power, stays put, claims', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    giveHand(s, 'p0', [STRONG_CARD_BY_SYMBOL[symbol]]);
    const before = pos(s, 'p0');
    const r = run(
      s, 'p0',
      { type: 'PlayMovementCard', cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(true);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(before); // 留在原地
    const power = getDef(STRONG_CARD_BY_SYMBOL[symbol]).power;
    expect(r.state.turn!.activeMover).toEqual({ cardId: `p0:${STRONG_CARD_BY_SYMBOL[symbol]}#t0`, symbol, remaining: power - blockade.cost });
  });

  it('symbol blockade: errors when mover power < blockade.cost', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    blockade.cost = 2; // force cost to 2 so the weak card (power 1) is insufficient
    const symbol = blockadeSymbolForTest(blockade);
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    // weak card: power 1 (explorer/sailor/traveller); blockade.cost is 2
    const weak = BASIC_CARD_BY_SYMBOL[symbol];
    giveHand(s, 'p0', [weak]);
    const r = run(
      s, 'p0',
      { type: 'PlayMovementCard', cardId: `p0:${weak}#t0`, symbol },
      { type: 'RemoveBlockade', blockadeId: blockade.id },
    );
    expect(r.result.ok).toBe(false);
  });

  it('rubble blockade: discards exactly cost cards, stays put, claims, no draw', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades.find((b) => b.terrain === 'rubble')!;
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const edge = blockade.edges.find((e) => hexAt(e.a).terrain !== 'mountain' && hexAt(e.b).terrain !== 'mountain') ?? blockade.edges[0];
    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);
    const before = pos(s, 'p0');
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id, cardIds: ['p0:pioneer#t0'] });
    expect(r.result.ok).toBe(true);
    expect(r.state.blockades.find((b) => b.id === blockade.id)!.claimedBy).toBe('p0');
    expect(pos(r.state, 'p0')).toEqual(before); // 留在原地
    expect(r.state.players[0].discard.some((c) => c.id === 'p0:pioneer#t0')).toBe(true);
  });

  it('rubble blockade: errors when card count != cost', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades.find((b) => b.terrain === 'rubble')!;
    const hexAt = (c: Axial) => s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
    const edge = blockade.edges.find((e) => hexAt(e.a).terrain !== 'mountain' && hexAt(e.b).terrain !== 'mountain') ?? blockade.edges[0];
    placeAt(s, 'p0', edge.a);
    giveHand(s, 'p0', ['pioneer', 'explorer']);
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id, cardIds: ['p0:pioneer#t0', 'p0:explorer#t1'] });
    expect(r.result.ok).toBe(false);
  });

  it('errors on an already-claimed blockade', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    blockade.claimedBy = 'p1';
    const crossing = seamCrossing(s, blockade, true)!;
    placeAt(s, 'p0', crossing.from);
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id });
    expect(r.result.ok).toBe(false);
  });

  it('errors when the pawn is not beside the blockade', () => {
    const s = createGame(
      [ { id: 'p0', name: 'A', color: 'red' as const }, { id: 'p1', name: 'B', color: 'blue' as const } ],
      'classic', 11,
    );
    const blockade = s.blockades[0];
    // Place p0 at a start hex that is NOT on any of this blockade's edges
    const start = s.hexes.find((h) => h.terrain === 'start')!;
    placeAt(s, 'p0', { q: start.q, r: start.r });
    // Verify p0 is not beside any edge of the blockade
    const isAdjacent = blockade.edges.some((edge) =>
      (edge.a.q === s.players[0].position.q && edge.a.r === s.players[0].position.r) ||
      (edge.b.q === s.players[0].position.q && edge.b.r === s.players[0].position.r) ||
      neighbors(s.players[0].position).some((n) => (edge.a.q === n.q && edge.a.r === n.r) || (edge.b.q === n.q && edge.b.r === n.r))
    );
    expect(isAdjacent).toBe(false); // Sanity check: confirm pawn is not beside blockade
    const r = run(s, 'p0', { type: 'RemoveBlockade', blockadeId: blockade.id });
    expect(r.result.ok).toBe(false);
  });
});

describe('End-of-turn hand cap', () => {
  it('endTurn sets pendingTrim when human hand > HAND_SIZE', () => {
    const s = game(2);
    // Force p0 hand to exactly 5 cards (HAND_SIZE + 1).
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer', 'scout']);
    expect(s.players[0].hand).toHaveLength(5);
    const idxBefore = s.currentPlayerIdx;
    const r = applyAction(s, 'p0', { type: 'EndTurn' });
    expect(r.result.ok).toBe(true);
    expect(r.state.turn?.pendingTrim).toEqual({ max: 4 });
    expect(r.state.currentPlayerIdx).toBe(idxBefore); // did not advance
  });

  it('endTurn does NOT set pendingTrim when human hand === HAND_SIZE', () => {
    const s = game(2);
    // Force p0 hand to exactly 4 cards (HAND_SIZE).
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer']);
    expect(s.players[0].hand).toHaveLength(4);
    const r = applyAction(s, 'p0', { type: 'EndTurn' });
    expect(r.result.ok).toBe(true);
    expect(r.state.turn?.pendingTrim).toBeUndefined();
    // The turn should still advance normally.
    expect(r.state.currentPlayerIdx).not.toBe(s.currentPlayerIdx);
  });

  it('dispatch blocks non-DiscardCards actions when pendingTrim is set', () => {
    const s = game(2);
    // Force pendingTrim state by setting it directly on turn.
    s.turn!.pendingTrim = { max: 4 };
    const r = applyAction(s, 'p0', { type: 'EndTurn' });
    expect(r.result.ok).toBe(false);
    if (!r.result.ok) expect(r.result.error).toMatch(/先把手牌精简到/);
  });

  it('discardCards resolves pendingTrim: hand 5 → 4, advance without draw', () => {
    const s = game(2);
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer', 'scout']);
    expect(s.players[0].hand).toHaveLength(5);
    s.turn!.pendingTrim = { max: 4 };
    const before = s.currentPlayerIdx;
    const r = applyAction(s, 'p0', { type: 'DiscardCards', cardIds: ['p0:scout#t4'] });
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return; // type guard
    expect(r.state.turn?.pendingTrim).toBeUndefined();
    expect(r.state.players[0].hand.length).toBe(4);
    expect(r.state.currentPlayerIdx).not.toBe(before); // advanced
    expect(r.state.players[0].discard.length).toBe(1);
  });

  it('discardCards resolves pendingTrim: hand 6 → 3, then draws 1', () => {
    const s = game(2);
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer', 'scout', 'navigator']);
    expect(s.players[0].hand).toHaveLength(6);
    s.turn!.pendingTrim = { max: 4 };
    const ids = s.players[0].hand.slice(0, 3).map((c) => c.id);
    const r = applyAction(s, 'p0', { type: 'DiscardCards', cardIds: ids });
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return;
    expect(r.state.turn?.pendingTrim).toBeUndefined();
    expect(r.state.players[0].hand.length).toBe(4); // 3 remaining + draw 1
  });

  it('discardCards keeps pendingTrim open if hand still > max', () => {
    const s = game(2);
    // Start with 6 cards, pendingTrim = { max: 4 }. Discard only 1 -> hand 5,
    // still > max, so pendingTrim must stay open and the turn must NOT advance.
    giveHand(s, 'p0', ['explorer', 'sailor', 'traveller', 'photographer', 'scout', 'navigator']);
    expect(s.players[0].hand).toHaveLength(6);
    s.turn!.pendingTrim = { max: 4 };
    const before = s.currentPlayerIdx;
    const discardId = s.players[0].hand[0].id;
    const r = applyAction(s, 'p0', { type: 'DiscardCards', cardIds: [discardId] });
    expect(r.result.ok).toBe(true);
    if (!r.result.ok) return;
    expect(r.state.turn?.pendingTrim).toEqual({ max: 4 }); // still open
    expect(r.state.players[0].hand.length).toBe(5); // 6 - 1 = 5, still > max
    expect(r.state.currentPlayerIdx).toBe(before); // did NOT advance
  });

  it('AI safety net: endTurn with AI hand > 4 auto-discards lowest-power and advances', () => {
    const s = game(2);
    s.players[0].isAI = true;
    // Mix of powers: explorer(1), sailor(1), scout(2), sailor(1), scientist(0)
    // Lowest-power-first discard should drop scientist(0), then one of the 1-powers.
    giveHand(s, 'p0', ['explorer', 'sailor', 'scout', 'sailor', 'scientist']);
    expect(s.players[0].hand).toHaveLength(5);
    const before = s.currentPlayerIdx;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = applyAction(s, 'p0', { type: 'EndTurn' });
      expect(r.result.ok).toBe(true);
      if (!r.result.ok) return;
      expect(r.state.turn?.pendingTrim).toBeUndefined();
      expect(r.state.players[0].hand.length).toBe(4);
      expect(r.state.currentPlayerIdx).not.toBe(before); // advanced
      // AI safety net MUST emit the [AI-TRIM-SAFETY] warning
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AI-TRIM-SAFETY]'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('AI safety net does NOT fire when AI hand ≤ 4', () => {
    const s = game(2);
    s.players[0].isAI = true;
    giveHand(s, 'p0', ['sailor', 'explorer', 'sailor', 'explorer']);
    expect(s.players[0].hand).toHaveLength(4);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = applyAction(s, 'p0', { type: 'EndTurn' });
      expect(warnSpy).not.toHaveBeenCalled();
      expect(r.result.ok).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('AI safety net fires for offline player too', () => {
    const s = game(2);
    s.players[0].offline = true;
    giveHand(s, 'p0', ['sailor', 'explorer', 'sailor', 'explorer', 'sailor']);
    expect(s.players[0].hand).toHaveLength(5);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = applyAction(s, 'p0', { type: 'EndTurn' });
      expect(r.result.ok).toBe(true);
      if (!r.result.ok) return;
      expect(r.state.players[0].hand.length).toBe(4);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AI-TRIM-SAFETY]'));
    } finally {
      warnSpy.mockRestore();
    }
  });
});
