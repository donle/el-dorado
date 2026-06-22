import {
  createGame,
  applyAction,
  planTurn,
  getMap,
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
  offline: boolean;
  send: Send | null;
}

let seq = 0;
const newId = (prefix: string) => `${prefix}${(seq++).toString(36)}${Date.now().toString(36)}`;

export class Room {
  readonly code: string;
  hostId = '';
  mapId = 'classic';
  aiDelayMs = 1000;
  closed = false;
  private aiRunning = false;
  private sleep: (ms: number) => Promise<void>;
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  members: Member[] = [];
  game: GameState | null = null;

  constructor(code: string, sleep?: (ms: number) => Promise<void>) {
    this.code = code;
    this.sleep = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private nextColor(): PlayerColor {
    const taken = new Set(this.members.map((m) => m.color));
    return COLORS.find((c) => !taken.has(c)) ?? 'red';
  }

  addHuman(name: string, send: Send): Member {
    if (this.members.length >= 4) throw new Error('房间人数已满');
    if (this.phase !== 'lobby') throw new Error('游戏已经开始');
    const m: Member = { id: newId('h'), name: name || '玩家', color: this.nextColor(), isAI: false, offline: false, send };
    this.members.push(m);
    if (!this.hostId) this.hostId = m.id;
    return m;
  }

  addAI(): Member {
    if (this.members.length >= 4) throw new Error('房间人数已满');
    if (this.phase !== 'lobby') throw new Error('游戏已经开始');
    const n = this.members.filter((m) => m.isAI).length + 1;
    const m: Member = { id: newId('ai'), name: `电脑 ${n}`, color: this.nextColor(), isAI: true, offline: false, send: null };
    this.members.push(m);
    return m;
  }

  remove(playerId: string): void {
    this.members = this.members.filter((m) => m.id !== playerId);
    this.assignHost();
  }

  reconnect(playerId: string, send: Send): Member | null {
    const m = this.members.find((x) => x.id === playerId);
    if (m) {
      m.send = send;
      if (m.offline) {
        m.isAI = false;
        m.offline = false;
        this.syncGamePlayer(m);
      }
      this.assignHost();
    }
    return m ?? null;
  }

  disconnect(playerId: string, send?: Send): boolean {
    const m = this.members.find((x) => x.id === playerId);
    if (!m) return false;
    if (send && m.send !== send) return false;
    m.send = null;
    if (this.phase === 'playing' && !m.isAI && !m.offline) {
      m.isAI = true;
      m.offline = true;
      this.syncGamePlayer(m);
    }
    this.assignHost();
    return true;
  }

  member(id: string): Member | undefined {
    return this.members.find((m) => m.id === id);
  }

  /** Set the per-action AI pacing delay. Host-only; clamped to [0, 10000] ms. */
  setAiDelay(playerId: string, ms: number): void {
    if (playerId !== this.hostId) return;
    this.aiDelayMs = Math.max(0, Math.min(10000, Math.round(ms)));
  }

  setMap(mapId: string): void {
    if (this.phase !== 'lobby') throw new Error('游戏已经开始');
    getMap(mapId); // validate before mutating room state
    this.mapId = mapId;
  }

  view(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      mapId: this.mapId,
      aiDelayMs: this.aiDelayMs,
      players: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        color: m.color,
        isAI: m.isAI,
        connected: m.offline ? false : m.isAI || m.send !== null,
        offline: m.offline,
      })),
    };
  }

  start(mapId = this.mapId, seed = Date.now() & 0xffff): void {
    if (this.members.length < 2) throw new Error('至少需要 2 名玩家');
    this.mapId = mapId;
    const seeds: PlayerSeed[] = this.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      isAI: m.isAI,
      offline: m.offline,
    }));
    this.game = createGame(seeds, mapId, seed);
    this.phase = 'playing';
  }

  returnToLobby(): void {
    if (this.phase !== 'finished') throw new Error('游戏还没有结束');
    this.game = null;
    this.phase = 'lobby';
    this.assignHost();
  }

  broadcast(msg: ServerMessage): void {
    for (const m of this.members) m.send?.(msg);
  }

  broadcastClosed(message: string, excludePlayerId?: string): void {
    this.closed = true;
    for (const m of this.members) {
      if (m.id !== excludePlayerId) m.send?.({ type: 'roomClosed', message });
    }
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
    if (!this.game) return { ok: false, error: '当前没有进行中的游戏' };
    if (this.currentPlayerId() !== playerId) return { ok: false, error: '还没轮到你' };

    const res = applyAction(this.game, playerId, action);
    if (!res.result.ok) return { ok: false, error: res.result.error };
    this.game = res.state;
    this.broadcastState(res.result.events);
    if (this.game.phase === 'finished') {
      this.phase = 'finished';
      this.broadcastRoom();
    }

    void this.runAITurns();
    return { ok: true };
  }

  /** Run AI turns until it's a human's turn or the game ends, pacing each
   * applied action by aiDelayMs. async; callers fire-and-forget with `void`. */
  async runAITurns(): Promise<void> {
    if (this.aiRunning) return;
    this.aiRunning = true;
    try {
      // Safety backstop against a pathological no-progress loop. A full
      // all-AI game on a large map can legitimately take many hundreds of turns.
      let guard = 0;
      let first = true; // no delay before the very first action of the run
      while (this.game && this.game.phase === 'playing' && guard++ < 5000) {
        const cur = this.currentPlayerId();
        if (!cur) break;
        const m = this.member(cur);
        if (!m || !m.isAI) break;

        const plan = planTurn(this.game, cur);
        let forcedEnd = false;
        for (const act of plan) {
          if (!first) await this.sleep(this.aiDelayMs);
          first = false;
          const r = applyAction(this.game, cur, act);
          if (!r.result.ok) {
            forcedEnd = true;
            break;
          }
          this.game = r.state;
          this.broadcastState(r.result.events);
        }
        if (forcedEnd) {
          // Safety: ensure the AI relinquishes the turn even if its plan failed.
          if (!first) await this.sleep(this.aiDelayMs);
          first = false;
          const end = applyAction(this.game, cur, { type: 'EndTurn' });
          if (end.result.ok) {
            this.game = end.state;
            this.broadcastState(end.result.events);
          } else {
            break; // cannot recover; avoid an infinite loop
          }
        }
      }
      if (this.game && this.game.phase === 'finished' && this.phase !== 'finished') {
        this.phase = 'finished';
        this.broadcastRoom();
      }
    } finally {
      this.aiRunning = false;
    }
  }

  private syncGamePlayer(member: Member): void {
    const p = this.game?.players.find((x) => x.id === member.id);
    if (!p) return;
    p.isAI = member.isAI;
    p.offline = member.offline;
  }

  private assignHost(): void {
    const current = this.members.find((m) => m.id === this.hostId);
    if (current && !current.isAI && !current.offline && current.send) return;
    this.hostId =
      this.members.find((m) => !m.isAI && !m.offline && m.send)?.id ??
      this.members.find((m) => !m.offline)?.id ??
      this.members[0]?.id ??
      '';
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
    throw new Error('无法分配房间码');
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
