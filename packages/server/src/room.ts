import {
  createGame,
  applyAction,
  planTurn,
  type GameState,
  type PlayerColor,
  type RoomView,
  type ServerMessage,
  type GameEvent,
  type Action,
  type PlayerSeed,
} from '@eldorado/core';

const COLORS: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

export type Send = (msg: ServerMessage) => void;

interface Member {
  id: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  send: Send | null;
}

let seq = 0;
const newId = (prefix: string) => `${prefix}${(seq++).toString(36)}${Date.now().toString(36)}`;

export class Room {
  readonly code: string;
  hostId = '';
  mapId = 'classic';
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  members: Member[] = [];
  game: GameState | null = null;

  constructor(code: string) {
    this.code = code;
  }

  private nextColor(): PlayerColor {
    const taken = new Set(this.members.map((m) => m.color));
    return COLORS.find((c) => !taken.has(c)) ?? 'red';
  }

  addHuman(name: string, send: Send): Member {
    if (this.members.length >= 4) throw new Error('Room is full');
    if (this.phase !== 'lobby') throw new Error('Game already started');
    const m: Member = { id: newId('h'), name: name || 'Player', color: this.nextColor(), isAI: false, send };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    return m;
  }

  addAI(): Member {
    if (this.members.length >= 4) throw new Error('Room is full');
    if (this.phase !== 'lobby') throw new Error('Game already started');
    const n = this.members.filter((m) => m.isAI).length + 1;
    const m: Member = { id: newId('ai'), name: `AI ${n}`, color: this.nextColor(), isAI: true, send: null };
    this.members.push(m);
    return m;
  }

  remove(playerId: string): void {
    this.members = this.members.filter((m) => m.id !== playerId);
    if (this.hostId === playerId) this.hostId = this.members.find((m) => !m.isAI)?.id ?? '';
  }

  reconnect(playerId: string, send: Send): Member | null {
    const m = this.members.find((x) => x.id === playerId);
    if (m) m.send = send;
    return m ?? null;
  }

  disconnect(playerId: string): void {
    const m = this.members.find((x) => x.id === playerId);
    if (m) m.send = null;
  }

  member(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      mapId: this.mapId,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        isAI: m.isAI,
        connected: m.isAI ? true : m.send !== null,
      })),
    };
  }

  start(mapId = 'classic', seed = Date.now() & 0xffff): void {
    if (this.members.length < 2) throw new Error('Need at least 2 players');
    this.mapId = mapId;
    const seeds: PlayerSeed[] = this.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      isAI: m.isAI,
    }));
    this.game = createGame(seeds, mapId, seed);
    this.phase = 'playing';
  }

  broadcast(msg: ServerMessage): void {
    for (const m of this.members) m.send?.(msg);
  }

  broadcastRoom(): void {
    this.broadcast({ type: 'room', room: this.view() });
  }

  broadcastState(events: GameEvent[] = []): void {
    if (this.game) this.broadcast({ type: 'state', state: this.game, events });
  }

  private currentPlayerId(): string | null {
    if (!this.game || this.game.phase !== 'playing' || !this.game.turn) return null;
    return this.game.turn.playerId;
  }

  /** Apply a human action, then auto-run any AI turns that follow. */
  handleAction(playerId: string, action: Action): { ok: boolean; error?: string } {
    if (!this.game) return { ok: false, error: 'No game in progress' };
    if (this.currentPlayerId() !== playerId) return { ok: false, error: 'Not your turn' };

    const res = applyAction(this.game, playerId, action);
    if (!res.result.ok) return { ok: false, error: res.result.error };
    this.game = res.state;
    this.broadcastState(res.result.events);
    if (this.game.phase === 'finished') this.phase = 'finished';

    this.runAITurns();
    return { ok: true };
  }

  /** Run AI turns until it's a human's turn or the game ends. */
  runAITurns(): void {
    // Safety backstop against a pathological no-progress loop. A full
    // all-AI game on a large map can legitimately take many hundreds of turns.
    let guard = 0;
    while (this.game && this.game.phase === 'playing' && guard++ < 5000) {
      const cur = this.currentPlayerId();
      if (!cur) break;
      const m = this.member(cur);
      if (!m || !m.isAI) break;

      const plan = planTurn(this.game, cur);
      const events: GameEvent[] = [];
      let forcedEnd = false;
      for (const act of plan) {
        const r = applyAction(this.game, cur, act);
        if (!r.result.ok) {
          forcedEnd = true;
          break;
        }
        this.game = r.state;
        events.push(...r.result.events);
      }
      if (forcedEnd) {
        // Safety: ensure the AI relinquishes the turn even if its plan failed.
        const end = applyAction(this.game, cur, { type: 'EndTurn' });
        if (end.result.ok) {
          this.game = end.state;
          events.push(...end.result.events);
        } else {
          break; // cannot recover; avoid an infinite loop
        }
      }
      this.broadcastState(events);
    }
    if (this.game && this.game.phase === 'finished') this.phase = 'finished';
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  private newCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate room code');
  }

  create(): Room {
    const room = new Room(this.newCode());
    this.rooms.set(room.code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  dispose(code: string): void {
    this.rooms.delete(code);
  }
}
