import { describe, expect, it, vi } from 'vitest';
import type { Axial, GameState } from '@eldorado/core';
import { createHoverHost, type HoverHostSource } from './HoverHost.js';

describe('createHoverHost', () => {
  it('reads state and interaction lazily from the app host', () => {
    let state: GameState | null = null;
    const initialTryActOnHex = vi.fn(() => false);
    const currentTryActOnHex = vi.fn(() => true);
    let interaction = makeInteraction(initialTryActOnHex);

    const source: HoverHostSource = {
      get state() { return state; },
      you: 'p1',
      mobilePanel: null,
      board: makeBoard(),
      previewCtl: { hidePreview: vi.fn(), refreshPinnedPreview: vi.fn() },
      get interaction() { return interaction; },
    };

    const host = createHoverHost(source);
    state = makeState();
    interaction = makeInteraction(currentTryActOnHex);

    const target = { q: 0, r: 1 };

    expect(host.isMyTurn()).toBe(true);
    expect(host.me?.id).toBe('p1');
    expect(host.tryActOnHex(target)).toBe(true);
    expect(initialTryActOnHex).not.toHaveBeenCalled();
    expect(currentTryActOnHex).toHaveBeenCalledWith(target);
  });
});

function makeState(): GameState {
  return {
    phase: 'playing',
    players: [{ id: 'p1', name: 'A', color: 'red', isAI: false, position: { q: 0, r: 0 }, hand: [], discard: [], deck: [], played: [] }],
    turnOrder: ['p1'],
    turn: { playerId: 'p1', currentPlayerId: 'p1' },
    hexes: [],
    blockades: [],
    market: [],
    winnerId: null,
    log: [],
  } as unknown as GameState;
}

function makeInteraction(tryActOnHex: (c: Axial) => boolean): HoverHostSource['interaction'] {
  return {
    mode: 'idle',
    selected: new Set<string>(),
    nativeActionCardId: null,
    canEnter: vi.fn(),
    canStepToEldorado: vi.fn(),
    canUseNativeOn: vi.fn(),
    selectedHandCardIds: vi.fn(() => []),
    movementRequirement: vi.fn(),
    tryActOnHex,
    tryActOnBlockade: vi.fn(),
    blockadeDestination: vi.fn(),
    blockadeEdges: vi.fn(() => []),
  } as unknown as HoverHostSource['interaction'];
}

function makeBoard(): HoverHostSource['board'] {
  return {
    setInspectedHex: vi.fn(),
    setInspectedBlockade: vi.fn(),
    clearHover: vi.fn(),
    setHighlights: vi.fn(),
    setBlockadeHighlights: vi.fn(),
  };
}
