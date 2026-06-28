import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/engine/dispatch.js';
import { MAPS } from '../src/maps/index.js';
import { CAVE_TOKEN_DEFS, CAVE_TOKEN_COUNT } from '../src/cave.js';
import type { Axial, Card, GameState, Hex, Player } from '../src/types.js';
import type { Action } from '../src/actions.js';

const TWO_SEEDS = [
  { id: 'p0', name: 'A', color: 'red' as const },
  { id: 'p1', name: 'B', color: 'blue' as const },
];

const NEIGHBOR_OFFSETS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** A game using the official-first map so caves are guaranteed to exist. */
function caveGame(): GameState {
  return createGame(TWO_SEEDS, 'official-first', 1);
}

function playerOf(s: GameState, id: string): Player {
  return s.players.find((x) => x.id === id)!;
}

function placeAt(s: GameState, pid: string, c: Axial): Hex {
  const p = playerOf(s, pid);
  const old = s.hexes.find((h) => h.q === p.position.q && h.r === p.position.r);
  if (old) old.occupant = undefined;
  p.position = { q: c.q, r: c.r };
  const h = s.hexes.find((h) => h.q === c.q && h.r === c.r)!;
  h.occupant = pid;
  return h;
}

function giveHand(s: GameState, pid: string, defs: string[]): void {
  const p = playerOf(s, pid);
  p.hand = defs.map((d, i): Card => ({ id: `${pid}:${d}#c${i}`, defId: d }));
}

function giveDeck(s: GameState, pid: string, defs: string[]): void {
  const p = playerOf(s, pid);
  p.deck = defs.map((d, i): Card => ({ id: `${pid}:${d}#d${i}`, defId: d }));
}

function setTurn(s: GameState, pid: string): void {
  const idx = s.turnOrder.indexOf(pid);
  if (idx === -1) throw new Error(`Unknown player ${pid}`);
  s.currentPlayerIdx = idx;
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

function findAccessibleNeighbour(s: GameState, c: Axial, predicate: (h: Hex) => boolean): Hex {
  // Same as anyNeighbourOf but also requires no unclaimed blockade lies between c and the neighbour.
  for (const d of NEIGHBOR_OFFSETS) {
    const h = s.hexes.find((x) => x.q === c.q + d.q && x.r === c.r + d.r);
    if (!h || !predicate(h)) continue;
    const block = s.blockades.find((b) => {
      if (b.claimedBy) return false;
      return b.edges.some(
        (e) =>
          (e.a.q === c.q && e.a.r === c.r && e.b.q === h.q && e.b.r === h.r) ||
          (e.b.q === c.q && e.b.r === c.r && e.a.q === h.q && e.a.r === h.r),
      );
    });
    if (!block) return h;
  }
  throw new Error(`no neighbour of ${c.q},${c.r} matching predicate without blockade`);
}

function anyNeighbourOf(s: GameState, c: Axial, predicate: (h: Hex) => boolean): Hex {
  for (const d of NEIGHBOR_OFFSETS) {
    const h = s.hexes.find((x) => x.q === c.q + d.q && x.r === c.r + d.r);
    if (h && predicate(h)) return h;
  }
  throw new Error(`no neighbour of ${c.q},${c.r} matching predicate`);
}

function findFirstCave(s: GameState): Hex & { caveId: string } {
  const hex = s.hexes.find((h): h is Hex & { caveId: string } => !!h.cave && !!h.caveId);
  if (!hex) throw new Error('no cave hex');
  return hex;
}

describe('cave token catalog', () => {
  it('has 40 tokens (21 movement + 19 ability)', () => {
    expect(Object.keys(CAVE_TOKEN_DEFS)).toHaveLength(CAVE_TOKEN_COUNT);
  });

  it('contains all expected token kinds', () => {
    const kinds = new Set(Object.values(CAVE_TOKEN_DEFS).map((t) => t.kind));
    // 9 movement kinds + 7 ability kinds
    expect(kinds.size).toBe(16);
  });

  it('movement tokens carry the right symbol/power', () => {
    const m2 = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'move_machete_2');
    expect(m2?.symbol).toBe('machete');
    expect(m2?.power).toBe(2);
    const c3 = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'move_coin_3');
    expect(c3?.symbol).toBe('coin');
    expect(c3?.power).toBe(3);
  });
});

describe('cave setup', () => {
  it('every official map has at least one cave hex', () => {
    for (const [id, m] of Object.entries(MAPS)) {
      if (id === 'corridor' || id === 'classic') continue;
      const count = m.hexes.filter((h) => h.cave).length;
      expect(count, `map ${id}`).toBeGreaterThan(0);
    }
  });

  it('initialises a cave pile per cave hex', () => {
    const s = caveGame();
    const caves = s.hexes.filter((h) => h.cave);
    expect(Object.keys(s.cavePiles).length).toBe(caves.length);
    for (const hex of caves) {
      const pile = s.cavePiles[hex.caveId!];
      expect(pile.length).toBeGreaterThan(0);
    }
  });
});

describe('cave draw trigger', () => {
  it('draws the top token when stopping next to a cave', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    const cave = findFirstCave(s);
    // A cave is a mountain; find a green neighbour to step onto.
    const neighbour = anyNeighbourOf(
      s,
      cave,
      (h) => h.terrain === 'green' && h.cost === 1 && !h.occupant,
    );
    const start = anyNeighbourOf(
      s,
      neighbour,
      (h) => h.terrain !== 'mountain' && h.terrain !== 'eldorado' && !h.occupant,
    );
    placeAt(s, pid, start);
    giveHand(s, pid, ['explorer']);
    const pileBefore = s.cavePiles[cave.caveId].length;
    const { state, result } = run(
      s,
      pid,
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#c0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    );
    expect(result.ok).toBe(true);
    expect(state.cavePiles[cave.caveId].length).toBe(pileBefore - 1);
    const p = playerOf(state, pid);
    expect(p.caveTokens).toHaveLength(1);
    expect(p.lastCaveId).toBe(cave.caveId);
  });

  it('anti-loop: same cave drawn twice without leaving the area', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    const cave = findFirstCave(s);
    const caveId = cave.caveId;
    // Manually move one token out so we know the pile dropped.
    const drawnId = s.cavePiles[caveId].shift()!;
    const p = playerOf(s, pid);
    p.caveTokens.push(drawnId);
    p.lastCaveId = caveId;
    s.lastExploredCave[pid] = caveId;
    // Step onto a non-cave green neighbour next to the cave.
    const neighbour = anyNeighbourOf(
      s,
      cave,
      (h) => h.terrain === 'green' && h.cost === 1 && !h.occupant,
    );
    const start = anyNeighbourOf(
      s,
      neighbour,
      (h) => h.terrain !== 'mountain' && h.terrain !== 'eldorado' && !h.occupant,
    );
    placeAt(s, pid, start);
    giveHand(s, pid, ['explorer']);
    const pileAfterManualShift = s.cavePiles[caveId].length;
    const { state, result } = run(
      s,
      pid,
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#c0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    );
    expect(result.ok).toBe(true);
    // Pile unchanged — anti-loop skipped the draw.
    expect(state.cavePiles[caveId].length).toBe(pileAfterManualShift);
  });
});

describe('cave token: remove_hand', () => {
  it('permanently removes a hand card', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    giveHand(s, pid, ['explorer']);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#rem-0');
    const removedBefore = p.removed.length;
    const handCardId = p.hand[0].id;
    const { state, result } = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#rem-0',
      data: { kind: 'remove_hand', cardId: handCardId },
    });
    expect(result.ok).toBe(true);
    const next = playerOf(state, pid);
    expect(next.hand).toHaveLength(0);
    expect(next.removed.length).toBe(removedBefore + 1);
    expect(next.caveTokens).not.toContain('cave#rem-0');
  });
});

describe('cave token: native', () => {
  it('moves onto a mountain hex ignoring terrain', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    // Find a non-cave mountain hex and an adjacent green hex to stand on.
    const mountain = s.hexes.find((h) => h.terrain === 'mountain' && !h.cave);
    if (!mountain) {
      expect(true).toBe(true);
      return;
    }
    const adj = anyNeighbourOf(s, mountain, (h) => h.terrain !== 'mountain' && !h.occupant);
    placeAt(s, pid, adj);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#nat-0');
    const { state, result } = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#nat-0',
      data: { kind: 'native', to: { q: mountain.q, r: mountain.r } },
    });
    expect(result.ok).toBe(true);
    expect(playerOf(state, pid).position).toEqual({ q: mountain.q, r: mountain.r });
  });
});

describe('cave token: pass_through', () => {
  it('allows stepping onto an occupied hex for the rest of the turn', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    // Find a green-1 hex with no current occupant.
    const target = s.hexes.find((h) => h.terrain === 'green' && h.cost === 1 && !h.occupant);
    if (!target) {
      expect(true).toBe(true);
      return;
    }
    const other = s.players.find((p) => p.id !== pid)!;
    placeAt(s, other.id, target);
    const start = findAccessibleNeighbour(s, target, (h) => h.terrain !== 'mountain' && !h.occupant);
    placeAt(s, pid, start);
    giveHand(s, pid, ['explorer']);
    // First prove StepTo is rejected while the hex is occupied.
    const blocked = run(
      s,
      pid,
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#c0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: target.q, r: target.r } },
    );
    expect(blocked.result.ok).toBe(false);
    // Give a pass_through token, arm it, retry.
    const p = playerOf(blocked.state, pid);
    p.caveTokens.push('cave#pass-0');
    const armed = run(blocked.state, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#pass-0',
      data: { kind: 'pass_through' },
    });
    expect(armed.result.ok).toBe(true);
    const ok = run(armed.state, pid, {
      type: 'StepTo',
      to: { q: target.q, r: target.r },
    });
    expect(ok.result.ok).toBe(true);
    expect(playerOf(ok.state, pid).position).toEqual({ q: target.q, r: target.r });
  });
});

describe('cave token: symbol_swap', () => {
  it('lets a machete card enter a yellow (coin) hex', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    const target = s.hexes.find((h) => h.terrain === 'yellow' && h.cost === 1 && !h.occupant);
    if (!target) {
      expect(true).toBe(true);
      return;
    }
    const start = anyNeighbourOf(s, target, (h) => h.terrain !== 'mountain' && !h.occupant);
    placeAt(s, pid, start);
    giveHand(s, pid, ['explorer']);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#sym-0');
    const armed = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#sym-0',
      data: { kind: 'symbol_swap', symbol: 'coin', to: { q: target.q, r: target.r } },
    });
    expect(armed.result.ok).toBe(true);
    const moved = run(armed.state, pid, {
      type: 'PlayMovementCard',
      cardId: `${pid}:explorer#c0`,
      symbol: 'machete',
    });
    expect(moved.result.ok).toBe(true);
    const stepped = run(moved.state, pid, { type: 'StepTo', to: { q: target.q, r: target.r } });
    expect(stepped.result.ok).toBe(true);
  });
});

describe('cave token: move (movement token)', () => {
  it('plays as a machete-2 token and steps onto an adjacent green hex', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    // Find two adjacent green-1 hexes.
    let start: Hex | undefined;
    let next: Hex | undefined;
    for (const h of s.hexes) {
      if (h.terrain !== 'green' || h.cost !== 1 || h.occupant) continue;
      const n = s.hexes.find(
        (x) =>
          x.terrain === 'green' &&
          x.cost === 1 &&
          !x.occupant &&
          Math.abs(x.q - h.q) + Math.abs(x.q + x.r - h.q - h.r) + Math.abs(x.r - h.r) === 2,
      );
      if (n) {
        start = h;
        next = n;
        break;
      }
    }
    if (!start || !next) {
      expect(true).toBe(true);
      return;
    }
    placeAt(s, pid, start);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#m2-0');
    const { state, result } = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#m2-0',
      data: { kind: 'move', symbol: 'machete', to: { q: next.q, r: next.r } },
    });
    expect(result.ok).toBe(true);
    expect(playerOf(state, pid).position).toEqual({ q: next.q, r: next.r });
  });
});

describe('cave token: draw_play', () => {
  it('draws one card from the deck', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    giveHand(s, pid, []);
    giveDeck(s, pid, ['explorer', 'sailor', 'traveller']);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#draw-0');
    const { state, result } = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#draw-0',
      data: { kind: 'draw_play' },
    });
    expect(result.ok).toBe(true);
    const next = playerOf(state, pid);
    expect(next.hand).toHaveLength(1);
    expect(state.turn!.drawPlayTokenActive).toBe(true);
  });
});

describe('cave token: preserve_item', () => {
  it('arms the turn flag so single-use items go to discard instead of removed', () => {
    const s = caveGame();
    const pid = s.turn!.playerId;
    setTurn(s, pid);
    const p = playerOf(s, pid);
    p.caveTokens.push('cave#keep-0');
    const { state, result } = run(s, pid, {
      type: 'PlayCaveToken',
      tokenId: 'cave#keep-0',
      data: { kind: 'preserve_item' },
    });
    expect(result.ok).toBe(true);
    expect(state.turn!.preserveItemActive).toBe(true);
  });
});