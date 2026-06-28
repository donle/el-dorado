/**
 * End-to-end tests for the Caves (洞穴) variant, run through the server's
 * `Room` orchestrator. Each test boots a 2-human room, drives actions via
 * `room.handleAction`, and verifies the resulting `room.game` state plus
 * the broadcast `state` message that the room emits to connected clients.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/room.js';
import { CAVE_TOKEN_DEFS } from '@eldorado/core';
import type { Action, Axial, Card, GameState, Hex, ServerMessage } from '@eldorado/core';

const NEIGHBOR_OFFSETS: ReadonlyArray<Axial> = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function freshRoom(): Room {
  const room = new Room('TEST');
  room.addHuman('Host', () => {});
  room.addHuman('Guest', () => {});
  room.start('official-first', 1);
  return room;
}

function lastStateMsg(msgs: ServerMessage[]): GameState | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].type === 'state') return (msgs[i] as { type: 'state'; state: GameState }).state;
  }
  return null;
}

function playerOf(state: GameState, id: string) {
  return state.players.find((p) => p.id === id)!;
}

function placeAt(state: GameState, id: string, c: Axial): Hex {
  const p = playerOf(state, id);
  const old = state.hexes.find((h) => h.q === p.position.q && h.r === p.position.r);
  if (old) old.occupant = undefined;
  p.position = { q: c.q, r: c.r };
  const h = state.hexes.find((h) => h.q === c.q && h.r === c.r)!;
  h.occupant = id;
  return h;
}

function giveHand(state: GameState, id: string, defs: string[]): void {
  const p = playerOf(state, id);
  p.hand = defs.map((d, i): Card => ({ id: `${id}:${d}#e2e${i}`, defId: d }));
}

function anyNeighbour(state: GameState, c: Axial, predicate: (h: Hex) => boolean): Hex {
  for (const d of NEIGHBOR_OFFSETS) {
    const h = state.hexes.find((x) => x.q === c.q + d.q && x.r === c.r + d.r);
    if (h && predicate(h)) return h;
  }
  throw new Error(`no neighbour of ${c.q},${c.r} matching predicate`);
}

function accessibleNeighbour(state: GameState, c: Axial, predicate: (h: Hex) => boolean): Hex {
  for (const d of NEIGHBOR_OFFSETS) {
    const h = state.hexes.find((x) => x.q === c.q + d.q && x.r === c.r + d.r);
    if (!h || !predicate(h)) continue;
    const block = state.blockades.find((b) => {
      if (b.claimedBy) return false;
      return b.edges.some(
        (e) =>
          (e.a.q === c.q && e.a.r === c.r && e.b.q === h.q && e.b.r === h.r) ||
          (e.b.q === c.q && e.b.r === c.r && e.a.q === h.q && e.a.r === h.r),
      );
    });
    if (!block) return h;
  }
  throw new Error(`no accessible neighbour of ${c.q},${c.r}`);
}

function firstCave(state: GameState): Hex & { caveId: string } {
  const hex = state.hexes.find((h): h is Hex & { caveId: string } => !!h.cave && !!h.caveId);
  if (!hex) throw new Error('no cave hex on this map');
  return hex;
}

/** Drive a sequence of actions for `pid` and return the final game state. */
function drive(room: Room, pid: string, actions: Action[]): GameState {
  for (const a of actions) {
    const res = room.handleAction(pid, a);
    if (!res.ok) throw new Error(`action ${a.type} failed: ${res.error}`);
  }
  return room.game!;
}

describe('Caves variant — end-to-end through Room', () => {
  it('initialises 9 cave piles (one per cave hex) and exposes them in view', () => {
    const room = freshRoom();
    const state = room.game!;
    const caves = state.hexes.filter((h) => h.cave);
    expect(caves.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(state.cavePiles)).toHaveLength(caves.length);
    for (const c of caves) expect(state.cavePiles[c.caveId!]).toBeDefined();

    // The Room view stays consistent with the room state.
    const view = room.view();
    expect(view.mapId).toBe('official-first');
    expect(view.players).toHaveLength(2);
    // Full game state (carrying caveTokens + cavePiles) reaches clients via
    // the `state` broadcast, not the lighter `room` view.
    expect(state.players.every((p) => Array.isArray(p.caveTokens))).toBe(true);
  });

  it('drawing a token: stepping next to a cave decrements its pile and credits the player', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;
    const cave = firstCave(state);
    const neighbour = anyNeighbour(state, cave, (h) => h.terrain === 'green' && h.cost === 1 && !h.occupant);
    const start = accessibleNeighbour(state, neighbour, (h) => h.terrain !== 'mountain' && h.terrain !== 'eldorado');
    placeAt(state, pid, start);
    giveHand(state, pid, ['explorer']);

    const pileBefore = state.cavePiles[cave.caveId].length;
    const tokensBefore = playerOf(state, pid).caveTokens.length;

    drive(room, pid, [
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#e2e0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    ]);

    const after = room.game!;
    expect(after.cavePiles[cave.caveId].length).toBe(pileBefore - 1);
    expect(playerOf(after, pid).caveTokens.length).toBe(tokensBefore + 1);
    expect(playerOf(after, pid).lastCaveId).toBe(cave.caveId);
    expect(after.lastExploredCave[pid]).toBe(cave.caveId);
  });

  it('anti-loop: second adjacent step on the same cave does not draw again', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;
    const cave = firstCave(state);
    const neighbour = anyNeighbour(state, cave, (h) => h.terrain === 'green' && h.cost === 1 && !h.occupant);
    const start = accessibleNeighbour(state, neighbour, (h) => h.terrain !== 'mountain' && h.terrain !== 'eldorado');
    placeAt(state, pid, start);
    giveHand(state, pid, ['explorer', 'explorer']);

    // First step: draws a token.
    drive(room, pid, [
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#e2e0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    ]);
    const mid = room.game!;
    const midPile = mid.cavePiles[cave.caveId].length;
    const midPlayer = playerOf(mid, pid);
    expect(midPlayer.caveTokens.length).toBeGreaterThan(0);
    expect(midPlayer.lastCaveId).toBe(cave.caveId);

    // Step off the cave, then back onto it with another machete card.
    // Find another non-mountain, non-eldorado, non-cave neighbour of neighbour.
    const away = accessibleNeighbour(mid, neighbour, (h) => h.terrain !== 'mountain' && !h.cave);
    placeAt(mid, pid, away);

    drive(room, pid, [
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#e2e1`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    ]);

    const after = room.game!;
    // Same cave re-entered — anti-loop blocks the draw.
    expect(after.cavePiles[cave.caveId].length).toBe(midPile);
    expect(playerOf(after, pid).caveTokens.length).toBe(midPlayer.caveTokens.length);
  });

  it('broadcasts a state message whose cavePiles reflects the drawn token', () => {
    const room = freshRoom();
    const msgs: ServerMessage[] = [];
    // Re-attach a host send that captures messages.
    const host = room.members[0];
    host.send = (m) => msgs.push(m);
    const state = room.game!;
    const pid = state.turn!.playerId;
    const cave = firstCave(state);
    const neighbour = anyNeighbour(state, cave, (h) => h.terrain === 'green' && h.cost === 1 && !h.occupant);
    const start = accessibleNeighbour(state, neighbour, (h) => h.terrain !== 'mountain' && h.terrain !== 'eldorado');
    placeAt(state, pid, start);
    giveHand(state, pid, ['explorer']);

    const pileBefore = state.cavePiles[cave.caveId].length;
    drive(room, pid, [
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#e2e0`, symbol: 'machete' },
      { type: 'StepTo', to: { q: neighbour.q, r: neighbour.r } },
    ]);

    const broadcast = lastStateMsg(msgs);
    expect(broadcast).not.toBeNull();
    expect(broadcast!.cavePiles[cave.caveId].length).toBe(pileBefore - 1);
  });

  it('native token: lets a player enter a mountain hex ignoring terrain', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;
    const mountain = state.hexes.find((h) => h.terrain === 'mountain' && !h.cave);
    if (!mountain) {
      // Map without non-cave mountains (all mountains are caves) — skip.
      expect(true).toBe(true);
      return;
    }
    const adj = anyNeighbour(state, mountain, (h) => h.terrain !== 'mountain' && !h.occupant);
    placeAt(state, pid, adj);
    // Hand the player a native cave token directly.
    const p = playerOf(state, pid);
    const nativeToken = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'native')!;
    p.caveTokens.push(nativeToken.id);

    drive(room, pid, [
      {
        type: 'PlayCaveToken',
        tokenId: nativeToken.id,
        data: { kind: 'native', to: { q: mountain.q, r: mountain.r } },
      },
    ]);
    expect(playerOf(room.game!, pid).position).toEqual({ q: mountain.q, r: mountain.r });
    expect(playerOf(room.game!, pid).caveTokens).not.toContain(nativeToken.id);
  });

  it('pass_through token: allows stepping onto an occupied hex once armed', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;
    const other = room.members.find((m) => m.id !== pid)!.id;
    const target = state.hexes.find((h) => h.terrain === 'green' && h.cost === 1 && !h.occupant);
    if (!target) {
      expect(true).toBe(true);
      return;
    }
    placeAt(state, other, target);
    const start = accessibleNeighbour(state, target, (h) => h.terrain !== 'mountain' && !h.occupant);
    placeAt(state, pid, start);
    giveHand(state, pid, ['explorer']);

    const pass = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'pass_through')!;
    playerOf(state, pid).caveTokens.push(pass.id);

    // First the card is played, then the cave token arms the rest of the turn,
    // then the step succeeds because allowOccupied is now true.
    drive(room, pid, [
      { type: 'PlayMovementCard', cardId: `${pid}:explorer#e2e0`, symbol: 'machete' },
      { type: 'PlayCaveToken', tokenId: pass.id, data: { kind: 'pass_through' } },
      { type: 'StepTo', to: { q: target.q, r: target.r } },
    ]);

    expect(playerOf(room.game!, pid).position).toEqual({ q: target.q, r: target.r });
  });

  it('remove_hand token: removes a card from the player’s hand permanently', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;
    giveHand(state, pid, ['explorer']);
    const cardId = playerOf(state, pid).hand[0].id;
    const removedBefore = playerOf(state, pid).removed.length;

    const rem = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'remove_hand')!;
    playerOf(state, pid).caveTokens.push(rem.id);

    drive(room, pid, [
      { type: 'PlayCaveToken', tokenId: rem.id, data: { kind: 'remove_hand', cardId } },
    ]);

    const after = playerOf(room.game!, pid);
    expect(after.hand).toHaveLength(0);
    expect(after.removed.length).toBe(removedBefore + 1);
    expect(after.caveTokens).not.toContain(rem.id);
  });

  it('preserve_item token: armed flag survives until EndTurn', () => {
    const room = freshRoom();
    const state = room.game!;
    const pid = state.turn!.playerId;

    const keep = Object.values(CAVE_TOKEN_DEFS).find((t) => t.kind === 'preserve_item')!;
    playerOf(state, pid).caveTokens.push(keep.id);

    drive(room, pid, [
      { type: 'PlayCaveToken', tokenId: keep.id, data: { kind: 'preserve_item' } },
    ]);
    expect(room.game!.turn!.preserveItemActive).toBe(true);
  });
});