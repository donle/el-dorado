import type { ClientMessage } from '@eldorado/core';
import { decodeMessage, encodeMessage } from './protocolCodec.js';
import type { ISocketPort, SocketEvent, SocketEventHandler, Unsubscribe } from './SocketPort.js';

/**
 * Thin typed WebSocket client with automatic reconnect and message queueing.
 *
 * Migrates 1:1 from the legacy `Net` class. Differences vs the legacy:
 *   - Multi-subscriber via `on(handler)` returning an unsubscribe (legacy was
 *     a single callback per event). Internally we still drive one socket.
 *   - `open` / `close` / `error` / `message` are unified into `SocketEvent`.
 *
 * Behavior preserved:
 *   - Auto-reconnect with exponential backoff (300ms * 2^attempt, capped at
 *     5s, attempt counter capped at 5).
 *   - Messages sent while disconnected are queued and flushed on `open`.
 *   - `connect()` is idempotent and resumes after a close.
 */
export class WebSocketAdapter implements ISocketPort {
  private ws: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private handlers = new Set<SocketEventHandler>();
  private closedByUser = false;

  constructor(private readonly url: string) {
    this.connect();
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMessage(msg));
      return;
    }
    this.queue.push(msg);
    if (!this.ws) this.connect();
  }

  on(handler: SocketEventHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.queue = [];
  }

  /** Backwards-compat URL resolver matching the legacy `Net.connect` logic. */
  static defaultUrl(): string {
    return import.meta.env.DEV
      ? `ws://${location.hostname}:8787/ws`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  private connect(): void {
    if (this.closedByUser) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.emit({ kind: 'open' });
      this.queue.forEach((m) => ws.send(encodeMessage(m)));
      this.queue = [];
    };
    ws.onmessage = (ev) => {
      try {
        this.emit({ kind: 'message', payload: decodeMessage(ev.data as string) });
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.emit({ kind: 'close', reason: '' });
      if (this.closedByUser) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      this.emit({ kind: 'error', message: 'ws error' });
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(5000, 300 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private emit(e: SocketEvent): void {
    for (const h of this.handlers) h(e);
  }
}
