import type { WebSocket } from 'ws';
import type { ConnectionState } from '@eldorado/core';
import type { IClock } from '../shared/ports.js';

const HEARTBEAT_MS = 30_000;

interface ConnRecord {
  ws: WebSocket;
  lastPing: number;
  state: ConnectionState;
  alive: boolean;
}

/**
 * Tracks per-connection liveness. Stage 1 exposes the raw map so the legacy
 * shim in `index.ts` can still look up a WebSocket by connId; Stage 7 will
 * retire that shim and route all sends through `IMessageBus`.
 */
export class ConnectionTracker {
  private conns = new Map<string, ConnRecord>();

  constructor(private readonly clock: IClock) {}

  add(connId: string, ws: WebSocket): void {
    this.conns.set(connId, {
      ws,
      lastPing: this.clock.now(),
      state: 'open',
      alive: true,
    });
  }

  remove(connId: string): void {
    this.conns.delete(connId);
  }

  get(connId: string): WebSocket | undefined {
    return this.conns.get(connId)?.ws;
  }

  getState(connId: string): ConnectionState | undefined {
    return this.conns.get(connId)?.state;
  }

  setState(connId: string, state: ConnectionState): void {
    const c = this.conns.get(connId);
    if (c) c.state = state;
  }

  markAlive(connId: string): void {
    const c = this.conns.get(connId);
    if (!c) return;
    c.lastPing = this.clock.now();
    c.alive = true;
  }

  reapStale(now: number): string[] {
    const stale: string[] = [];
    for (const [id, c] of this.conns) {
      if (now - c.lastPing > HEARTBEAT_MS) stale.push(id);
    }
    return stale;
  }
}
