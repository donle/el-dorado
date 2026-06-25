import { describe, it, expect } from 'vitest';
import {
  terrainSymbol,
  blockadeMoveSymbol,
  blockadeRequiresDiscard,
  isFinishEntrance,
  requiredFor,
  stepCost,
  sameCoord,
  cardDefId,
} from '../src/terrain.js';
import type { Blockade, GameState, Hex } from '../src/types.js';

function hex(q: number, r: number, terrain: Hex['terrain'], extra: Partial<Hex> = {}): Hex {
  return { q, r, terrain, cost: 0, ...extra } as Hex;
}

describe('terrainSymbol', () => {
  it('maps the three traversable terrains to their move symbols', () => {
    expect(terrainSymbol('green')).toBe('machete');
    expect(terrainSymbol('blue')).toBe('paddle');
    expect(terrainSymbol('yellow')).toBe('coin');
  });

  it('returns null for non-traversable / wildcard terrains', () => {
    expect(terrainSymbol('start')).toBeNull();
    expect(terrainSymbol('finish')).toBeNull();
    expect(terrainSymbol('eldorado')).toBeNull();
    expect(terrainSymbol('mountain')).toBeNull();
    expect(terrainSymbol('rubble')).toBeNull();
    expect(terrainSymbol('basecamp')).toBeNull();
  });
});

function blockade(overrides: Partial<Blockade>): Blockade {
  return { id: 'b', a: { q: 0, r: 0 }, b: { q: 1, r: 0 }, edges: [], terrain: 'green', cost: 1, ...overrides };
}

describe('blockadeMoveSymbol', () => {
  it('prefers the terrain symbol over the explicit `.symbol`', () => {
    expect(blockadeMoveSymbol(blockade({ terrain: 'green' }))).toBe('machete');
  });

  it('falls back to `.symbol` when terrain has no symbol', () => {
    expect(blockadeMoveSymbol(blockade({ terrain: 'rubble', symbol: 'coin' }))).toBe('coin');
  });

  it('returns null when neither terrain nor symbol map to a move symbol', () => {
    expect(blockadeMoveSymbol(blockade({ terrain: 'rubble' }))).toBeNull();
  });
});

describe('blockadeRequiresDiscard', () => {
  it('returns true for rubble terrain', () => {
    expect(blockadeRequiresDiscard(blockade({ terrain: 'rubble' }))).toBe(true);
  });

  it('returns true when the blockade has no usable move symbol', () => {
    expect(blockadeRequiresDiscard(blockade({ terrain: 'basecamp' }))).toBe(true);
  });

  it('returns false for a green/blue/yellow blockade with a move symbol', () => {
    expect(blockadeRequiresDiscard(blockade({ terrain: 'green' }))).toBe(false);
  });
});

describe('isFinishEntrance', () => {
  it('returns true for finish hexes', () => {
    expect(isFinishEntrance(hex(0, 0, 'finish'))).toBe(true);
  });

  it('returns true for hexes flagged as finishEntrance', () => {
    expect(isFinishEntrance(hex(0, 0, 'green', { finishEntrance: true }))).toBe(true);
  });

  it('returns false for ordinary hexes', () => {
    expect(isFinishEntrance(hex(0, 0, 'green'))).toBe(false);
  });

  it('returns false for null / undefined', () => {
    expect(isFinishEntrance(null)).toBe(false);
    expect(isFinishEntrance(undefined)).toBe(false);
  });
});

describe('requiredFor', () => {
  it('returns the explicit reqSymbol for finish hexes, ignoring terrain', () => {
    expect(requiredFor(hex(0, 0, 'finish', { reqSymbol: 'machete' }))).toBe('machete');
  });

  it('returns null for a finish hex with no reqSymbol (wildcard)', () => {
    expect(requiredFor(hex(0, 0, 'finish'))).toBeNull();
  });

  it('returns the hex\'s explicit reqSymbol when set on non-finish', () => {
    expect(requiredFor(hex(0, 0, 'start', { reqSymbol: 'paddle' }))).toBe('paddle');
  });

  it('falls back to terrain symbol for traversable terrains', () => {
    expect(requiredFor(hex(0, 0, 'green'))).toBe('machete');
    expect(requiredFor(hex(0, 0, 'blue'))).toBe('paddle');
    expect(requiredFor(hex(0, 0, 'yellow'))).toBe('coin');
  });
});

describe('stepCost', () => {
  it('always costs 1 to step onto start', () => {
    expect(stepCost(hex(0, 0, 'start', { cost: 0 }))).toBe(1);
    expect(stepCost(hex(0, 0, 'start', { cost: 3 }))).toBe(1);
  });

  it('costs 0 to step onto El Dorado', () => {
    expect(stepCost(hex(0, 0, 'eldorado', { cost: 99 }))).toBe(0);
  });

  it('clamps finish cost to a minimum of 1', () => {
    expect(stepCost(hex(0, 0, 'finish', { cost: 0 }))).toBe(1);
    expect(stepCost(hex(0, 0, 'finish', { cost: 4 }))).toBe(4);
  });

  it('returns the hex cost for ordinary terrains', () => {
    expect(stepCost(hex(0, 0, 'green', { cost: 2 }))).toBe(2);
  });
});

describe('sameCoord', () => {
  it('returns true for matching q and r', () => {
    expect(sameCoord({ q: 1, r: 2 }, { q: 1, r: 2 })).toBe(true);
  });

  it('returns false when q or r differ', () => {
    expect(sameCoord({ q: 1, r: 2 }, { q: 2, r: 2 })).toBe(false);
    expect(sameCoord({ q: 1, r: 2 }, { q: 1, r: 3 })).toBe(false);
  });
});

describe('cardDefId', () => {
  function makeStateWithCard(id: string, defId: string, pile: 'hand' | 'deck' | 'discard' | 'removed' = 'hand'): GameState {
    const card = { id, defId };
    const players = pile === 'hand' || pile === 'deck' || pile === 'discard' || pile === 'removed'
      ? [{ id: 'p1', name: 'P1', color: 'red', hand: pile === 'hand' ? [card] : [], deck: pile === 'deck' ? [card] : [], discard: pile === 'discard' ? [card] : [], removed: pile === 'removed' ? [card] : [] }]
      : [];
    return { players } as unknown as GameState;
  }

  it('looks up defId from a player hand', () => {
    expect(cardDefId('c1', makeStateWithCard('c1', 'machete-2'))).toBe('machete-2');
  });

  it('looks up defId from deck / discard / removed piles', () => {
    expect(cardDefId('c1', makeStateWithCard('c1', 'paddle-1', 'deck'))).toBe('paddle-1');
    expect(cardDefId('c1', makeStateWithCard('c1', 'coin-3', 'discard'))).toBe('coin-3');
    expect(cardDefId('c1', makeStateWithCard('c1', 'joker', 'removed'))).toBe('joker');
  });

  it('falls back to the regex extraction for orphan cardIds', () => {
    const state = { players: [] } as unknown as GameState;
    expect(cardDefId('p1:machete-2#0', state)).toBe('machete-2');
  });

  it('returns the raw cardId when nothing matches and the regex fails', () => {
    const state = { players: [] } as unknown as GameState;
    expect(cardDefId('orphan', state)).toBe('orphan');
  });
});
